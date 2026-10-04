"""Demo storyboard: scenes, the real commands each one runs, and the voiceover.

A sentence is either a string (spoken == caption) or (caption, spoken) when the TTS needs
a pronunciation hint. Numbers quoted here come from the deterministic gateway injections and
were checked against a full run; make_demo.py re-checks them against the recorded run.
"""

VOICE = "en-US-ChristopherNeural"
RATE = "+0%"

PHASES = ["INPUT · ingest", "SKILL 1 · validate", "SKILL 2 · detect", "SKILL 3 · sync + attest", "OUTPUT · attestation"]

SCENES = [
    {
        "id": "intro", "kind": "card", "phase": -1,
        "bullets": [
            "Organic blueberries ride overnight in reefer trucks",
            "A few warm hours can halve shelf life",
            "Telemetry today is unprovable: dropped, re-sent, edited",
            "BlueberryChain: 3 Cortex Code skills  →  verified audit trail in Snowflake",
        ],
        "say": [
            "Every night, truckloads of organic blueberries ride through California in refrigerated reefers.",
            "A reefer that runs warm for just a few hours can cut shelf life in half, and that is where the disputes start.",
            "Today the only evidence is IoT telemetry that nobody can prove is genuine. Loggers drop readings, gateways re-send them, and a temperature can be quietly edited before a claim is filed.",
            "This is BlueberryChain, built with Cortex Code: three modular skills that turn raw cold-chain telemetry into a verified, Snowflake-backed audit trail.",
        ],
    },
    {
        "id": "skills", "kind": "term", "phase": -1,
        "commands": ["uv run demo/bbc.py skills"],
        "say": [
            "The workflow lives in the repo as three Cortex Code project skills.",
            "A ledger integrity validator, a cold-chain anomaly detector, and a Snowflake audit sync.",
            "Each one does one job, and hands a clean artifact to the next.",
        ],
    },
    {
        "id": "ingest", "kind": "term", "phase": 0,
        "commands": ["uv run demo/bbc.py ingest"],
        "say": [
            "Input first. The gateway ingest resolves tonight's in-transit manifest straight from Snowflake: six real shipments from six ranches, all bound for the Tracy distribution center.",
            "Then it pulls the overnight logger dumps.",
            ("2,169 readings, each with a pulp temperature, a GPS fix and a door sensor, signed with Ed25519 and hash-chained to the reading before it.",
             "Two thousand, one hundred and sixty-nine readings, each with a pulp temperature, a GPS fix and a door sensor, signed with E D 25519, and hash-chained to the reading before it."),
            "Notice there are seven files for six trucks. Hold that thought.",
        ],
    },
    {
        "id": "validate", "kind": "term", "phase": 1,
        "commands": ["uv run demo/bbc.py skill run ledger-integrity-validator --run latest"],
        "say": [
            "Skill one, the ledger integrity validator, loads its trust anchor from Snowflake: the registered public key and genesis hash for every logger.",
            "Then it replays every reading against seven ledger rules.",
            ("Eight records fail. Someone rewrote a hot reading on the Ranch 14 load to 1.21 °C and re-hashed it, but could not re-sign it, and the very next link exposes the rewrite.",
             "Eight records fail. Someone rewrote a hot reading on the Ranch fourteen load to one point two one degrees, and re-hashed it, but could not re-sign it. And the very next link in the chain exposes the rewrite."),
            "We also catch a naive edit, a replayed reading, a reading deleted in transit, and three records from a rogue logger that was never registered. That was the seventh file.",
            ("2,161 readings survive verification.", "Two thousand, one hundred and sixty-one readings survive verification."),
        ],
    },
    {
        "id": "detect", "kind": "term", "phase": 2,
        "commands": ["uv run demo/bbc.py skill run coldchain-anomaly-detector --run latest"],
        "say": [
            "Skill two, the cold-chain anomaly detector, only ever sees verified data, so a tampered record can neither raise nor hide an alarm.",
            ("It checks excursions against the same 1.8 °C limit used by the BlueberryChain semantic view, plus door openings, GPS spoofing, stuck probes and statistical outliers.",
             "It checks excursions against the same one point eight degree limit used by the BlueberryChain semantic view, plus door openings, GPS spoofing, stuck probes, and statistical outliers."),
            ("The Ranch 14 load spent 3.8 hours above the limit, peaking at 4.66 °C. Verdict: HOLD.",
             "The Ranch fourteen load spent three point eight hours above the limit, peaking at four point six six degrees. Verdict: hold."),
            "Two loads go to inspection, and three are released.",
        ],
    },
    {
        "id": "sync", "kind": "term", "phase": 3,
        "commands": ["uv run demo/bbc.py skill run snowflake-audit-sync --run latest"],
        "say": [
            "Skill three syncs it all into Snowflake. Verified ledger rows, quarantined records and anomalies land in the LEDGER schema.",
            "The run is sealed with a Merkle root over every verified hash, and a signed attestation report is exported to a Snowflake stage.",
            "Then it proves the round trip: it reads the rows back out of Snowflake, re-derives the Merkle root, and verifies the signature.",
            ("The shipment trust view turns evidence into a decision: 2,101 kilograms of berries on hold.",
             "The shipment trust view turns evidence into a decision: two thousand, one hundred and one kilograms of berries on hold."),
        ],
    },
    {
        "id": "report", "kind": "term", "phase": 4,
        "commands": ["uv run demo/bbc.py report --run latest"],
        "say": [
            "Finally, the auditor's view.",
            "Using nothing but what is stored in Snowflake, an insurer or a retailer can recompute the report hash, check the signature, and rebuild the Merkle root themselves.",
            "Every verdict comes with its evidence attached.",
        ],
    },
    {
        "id": "outro", "kind": "card", "phase": 5,
        "say": [
            "Raw telemetry in. Tamper-evident evidence out. One automated workflow.",
            "That is BlueberryChain on Snowflake, built with Cortex Code.",
        ],
    },
]
