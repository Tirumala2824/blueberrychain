"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/client/session";
import { roleName } from "@/domain/format";
import { ModeBanner } from "./ModeBanner";
import styles from "./AppShell.module.css";

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { state, signOut } = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (state && !state.identity) router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
  }, [state, router, path]);

  if (!state?.identity) return <div className={styles.loading} aria-busy="true" />;
  const { identity } = state;

  return (
    <div className={wide ? `${styles.shell} ${styles.fixed}` : styles.shell}>
      <header className={styles.bar}>
        <Link href="/inbox" className={styles.mark}>
          BlueberryChain <span className={styles.markSub}>control tower</span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/inbox" aria-current={path.startsWith("/inbox") || path.startsWith("/cases") ? "page" : undefined}>Cases</Link>
          <Link href="/policy" aria-current={path.startsWith("/policy") ? "page" : undefined}>Policy</Link>
        </nav>
        <div className={styles.who} data-testid="persona-badge">
          <span className={styles.whoRole}>{roleName(identity.role)}</span>
          <span className={styles.whoUser}>
            Snowflake user <span className="id">{identity.user}</span>, role <span className="id">{identity.role}</span>
          </span>
          <button
            type="button"
            className={styles.signOut}
            onClick={async () => {
              await signOut();
              router.replace("/sign-in");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {state.mode === "fixture" && <ModeBanner />}
      <main className={wide ? styles.mainWide : styles.main}>{children}</main>
    </div>
  );
}
