import argparse
import io
import json

import pytest
from blueberrychain import snowcall
from blueberrychain.cli import governed_cmds, world_cmds
from blueberrychain.sim import world as w


def test_render_dollar_quotes_text_and_counts_placeholders():
    sql = snowcall.render("CALL P(?, ?, ?)", ["PARTY", '[{"a": "it\'s"}]', None])
    assert sql == 'CALL P($$PARTY$$, $$[{"a": "it\'s"}]$$, NULL)'
    with pytest.raises(ValueError, match="placeholders"):
        snowcall.render("CALL P(?)", [])
    with pytest.raises(ValueError, match=r"\$\$"):
        snowcall.render("CALL P(?)", ["a $$ b"])


class Recorder:
    def __init__(self, result):
        self.calls, self.result = [], result

    def __call__(self, statement, params):
        self.calls.append((statement, params))
        return [[json.dumps(self.result)]]


def test_ref_load_calls_apply_for_every_entity_in_dependency_order(tmp_path):
    world = w.load_world()
    w.write_batches(w.reference_batches(world), tmp_path, "1")
    rec = Recorder({"status": "OK", "inserted": 1, "unchanged": 0, "ledger_seq": 7})
    args = argparse.Namespace(dir=tmp_path, reason="initial load", identity="builder")
    assert governed_cmds.run_ref_load(args, runner=rec) == 0
    assert [p[0] for _, p in rec.calls] == governed_cmds.LOAD_ORDER
    statement, (_entity, records, reason) = rec.calls[0]
    assert statement == governed_cmds.APPLY and reason == "initial load"
    assert {r["party_id"] for r in json.loads(records)} >= {"PARTY-BHM", "PARTY-SUMMIT"}


def test_ref_load_reports_a_no_op_reload(tmp_path, capsys):
    w.write_batches(w.reference_batches(w.load_world()), tmp_path, "1")
    rec = Recorder({"status": "OK", "inserted": 0, "unchanged": 3, "ledger_seq": None})
    args = argparse.Namespace(dir=tmp_path, reason="reload", identity="builder")
    assert governed_cmds.run_ref_load(args, runner=rec) == 0
    assert "no change" in capsys.readouterr().out


def test_ref_load_reports_invalid_batches(tmp_path):
    w.write_batches(w.reference_batches(w.load_world()), tmp_path, "1")
    rec = Recorder({"status": "INVALID", "errors": ["records[0] /x: bad"]})
    args = argparse.Namespace(dir=tmp_path, reason="r", identity="builder")
    assert governed_cmds.run_ref_load(args, runner=rec) == 1


def test_policy_draft_and_activate(tmp_path):
    rec = Recorder({"status": "OK", "policy_version": "2"})
    args = argparse.Namespace(path=world_cmds.DEFAULT_POLICY, identity="builder")
    assert governed_cmds.run_policy_draft(args, runner=rec) == 0
    current = json.loads(world_cmds.DEFAULT_POLICY.read_text(encoding="utf-8"))["policy_version"]
    assert json.loads(rec.calls[0][1][0])["policy_version"] == current

    rec = Recorder({"status": "DENIED", "errors": ["separation of duties"]})
    args = argparse.Namespace(version="1", reason="go live", identity="govadmin")
    assert governed_cmds.run_policy_activate(args, runner=rec) == 1
    assert rec.calls[0] == (governed_cmds.ACTIVATE, ["1", "go live"])


def test_persona_runner_requires_its_pat():
    with pytest.raises(RuntimeError, match="BBC_GOVADMIN_PAT"):
        snowcall.runner_for("govadmin", env={"SNOWFLAKE_ACCOUNT": "acct"})
    with pytest.raises(ValueError, match="unknown identity"):
        snowcall.runner_for("intern", env={})


def test_sqlapi_request_shape(monkeypatch):
    seen = {}

    class Response(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(request, timeout):
        seen["url"], seen["headers"] = request.full_url, dict(request.header_items())
        seen["body"] = json.loads(request.data)
        return Response(json.dumps({"data": [['{"status": "OK"}']]}).encode())

    monkeypatch.setattr(snowcall.urllib.request, "urlopen", fake_urlopen)
    env = {"SNOWFLAKE_ACCOUNT": "pndvhar-pt70809", "BBC_GOVADMIN_PAT": "tok"}
    run = snowcall.runner_for("govadmin", env=env)
    assert snowcall.call_json(run, "CALL BBC_OS.API.ACTIVATE_POLICY(?, ?)", ["1", "go"]) == {
        "status": "OK"
    }
    assert seen["url"] == "https://pndvhar-pt70809.snowflakecomputing.com/api/v2/statements"
    assert seen["headers"]["Authorization"] == "Bearer tok"
    assert seen["headers"]["X-snowflake-authorization-token-type"] == "PROGRAMMATIC_ACCESS_TOKEN"
    assert seen["body"]["role"] == "BBC_GOVERNANCE_ADMIN" and seen["body"]["database"] == "BBC_OS"
    assert seen["body"]["bindings"] == {
        "1": {"type": "TEXT", "value": "1"},
        "2": {"type": "TEXT", "value": "go"},
    }


def test_builder_runner_sends_sql_through_a_file_without_templating(monkeypatch):
    seen = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        path = cmd[cmd.index("-f") + 1]
        with open(path, encoding="utf-8") as handle:
            seen["sql"] = handle.read()

        class Proc:
            returncode, stderr = 0, ""
            stdout = json.dumps([{"R": '{"status": "OK"}'}])

        return Proc()

    monkeypatch.setattr(snowcall.shutil, "which", lambda _: "snow")
    monkeypatch.setattr(snowcall.subprocess, "run", fake_run)
    run = snowcall.snow_runner("conn")
    payload = '{"note": "&{not_a_var} <% x %>"}'
    assert snowcall.call_json(run, "CALL P(?)", [payload]) == {"status": "OK"}
    assert seen["cmd"][seen["cmd"].index("--enable-templating") + 1] == "NONE"
    assert seen["sql"] == f"CALL P($${payload}$$)"
