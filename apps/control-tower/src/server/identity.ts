/**
 * Who a signed-in person is, and how the server acts as them in Snowflake.
 *
 * Each persona is its own Snowflake user with its own role-restricted PAT (ADR-0003),
 * so Snowflake attributes every approval to CURRENT_USER(). The PAT is read from the
 * server's environment on every call: it is never stored in the session, never logged
 * and never sent to the browser. `IdentityProvider` is the seam for real SSO later.
 */

import { SqlApiClient, sqlApiConfigFromEnv } from "@blueberrychain/shared";
import {
  AnalystClient,
  createSqlPersonaPort,
  type FixtureWorld,
  type Persona,
  type PersonaPort,
  type PersonaRole,
} from "@blueberrychain/bbc-api";

export interface Identity {
  persona: Persona;
  user: string;
  role: PersonaRole;
  provider: "pat" | "fixture";
}

export interface PersonaOption {
  persona: Persona;
  title: string;
  user: string;
  role: PersonaRole;
  /** False when the server has no credential for this persona. */
  available: boolean;
}

export interface AnalystClients {
  analyst: AnalystClient;
  sql: SqlApiClient;
}

export interface IdentityProvider {
  readonly kind: Identity["provider"];
  options(): PersonaOption[];
  /** Verify the persona against Snowflake (or the tape) and return who they are. */
  signIn(persona: Persona): Promise<Identity>;
  port(identity: Identity): PersonaPort;
  /** Clients for Cortex Analyst as this identity (live mode only). */
  analyst(identity: Identity): AnalystClients | null;
}

export class SignInError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "SignInError";
  }
}

export const PERSONA_SPECS: Record<Persona, { title: string; env: string; role: PersonaRole; user: string }> = {
  quality: { title: "Quality & operations manager", env: "QUALITY", role: "BBC_QUALITY_MGR", user: "BBC_DEMO_QUALITY" },
  sales: { title: "Sales manager", env: "SALES", role: "BBC_SALES_MGR", user: "BBC_DEMO_SALES" },
  finance: { title: "Finance manager", env: "FINANCE", role: "BBC_FINANCE_MGR", user: "BBC_DEMO_FINANCE" },
  auditor: { title: "Auditor", env: "AUDITOR", role: "BBC_AUDITOR", user: "BBC_DEMO_AUDITOR" },
  govadmin: { title: "Governance admin", env: "GOVADMIN", role: "BBC_GOVERNANCE_ADMIN", user: "BBC_DEMO_GOVADMIN" },
};
export const PERSONA_ORDER = Object.keys(PERSONA_SPECS) as Persona[];

/** Live: one Snowflake user and PAT per persona, from .env (BBC_<PERSONA>_USER / _PAT). */
export class PatPersonaProvider implements IdentityProvider {
  readonly kind = "pat" as const;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private extra() {
    return this.fetchImpl ? { fetch: this.fetchImpl } : {};
  }

  private expectedUser(persona: Persona): string {
    const spec = PERSONA_SPECS[persona];
    return (this.env[`BBC_${spec.env}_USER`] ?? spec.user).toUpperCase();
  }

  private client(persona: Persona): SqlApiClient {
    const spec = PERSONA_SPECS[persona];
    return new SqlApiClient({ ...sqlApiConfigFromEnv(`BBC_${spec.env}_PAT`, spec.role, this.env), queryTag: "bbc-ct", ...this.extra() });
  }

  options(): PersonaOption[] {
    return PERSONA_ORDER.map((persona) => {
      const spec = PERSONA_SPECS[persona];
      return {
        persona,
        title: spec.title,
        user: this.expectedUser(persona),
        role: spec.role,
        available: Boolean(this.env["SNOWFLAKE_ACCOUNT"] && this.env[`BBC_${spec.env}_PAT`]),
      };
    });
  }

  async signIn(persona: Persona): Promise<Identity> {
    const spec = PERSONA_SPECS[persona];
    if (!this.options().find((o) => o.persona === persona)?.available) {
      throw new SignInError(`No credential is configured for ${spec.title} (set BBC_${spec.env}_PAT in .env).`, 503);
    }
    const who = await createSqlPersonaPort(this.client(persona)).whoami();
    if (who.role.toUpperCase() !== spec.role) {
      throw new SignInError(`Snowflake signed this token in as role ${who.role}, not ${spec.role}; the token's role restriction is wrong.`);
    }
    if (who.user.toUpperCase() !== this.expectedUser(persona)) {
      throw new SignInError(`Snowflake signed this token in as ${who.user}, not ${this.expectedUser(persona)}.`);
    }
    return { persona, user: who.user.toUpperCase(), role: spec.role, provider: "pat" };
  }

  port(identity: Identity): PersonaPort {
    return createSqlPersonaPort(this.client(identity.persona));
  }

  analyst(identity: Identity): AnalystClients {
    const config = sqlApiConfigFromEnv(`BBC_${PERSONA_SPECS[identity.persona].env}_PAT`, identity.role, this.env);
    return {
      analyst: new AnalystClient({ account: config.account, token: config.token, ...(config.host ? { host: config.host } : {}), ...this.extra() }),
      sql: new SqlApiClient({ ...config, queryTag: "bbc-ct", ...this.extra() }),
    };
  }
}

/** Fixture: the identities recorded on the tapes; nothing reaches Snowflake. */
export class FixtureIdentityProvider implements IdentityProvider {
  readonly kind = "fixture" as const;

  constructor(private readonly world: FixtureWorld) {}

  options(): PersonaOption[] {
    return PERSONA_ORDER.map((persona) => {
      const id = this.world.identity(persona);
      const spec = PERSONA_SPECS[persona];
      return { persona, title: spec.title, user: id?.user ?? spec.user, role: spec.role, available: Boolean(id) };
    });
  }

  async signIn(persona: Persona): Promise<Identity> {
    const id = this.world.identity(persona);
    if (!id) throw new SignInError(`No loaded tape records persona ${persona}.`, 503);
    return { persona, user: id.user, role: id.role as PersonaRole, provider: "fixture" };
  }

  port(identity: Identity): PersonaPort {
    return this.world.portFor(identity.persona);
  }

  analyst(): null {
    return null;
  }
}

export function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && value in PERSONA_SPECS;
}
