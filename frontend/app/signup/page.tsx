"use client";

import { useEffect } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useRouter } from "next/navigation";

function OrbitLogo() {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/logo.png"
      alt="EnPlanIt Logo"
      width={48}
      height={48}
      className="w-12 h-12 object-contain filter drop-shadow-[0_0_12px_rgba(59,130,246,0.5)]"
    />
  );
}

export default function SignupPage() {
  const { user, isLoading } = useUser();
  const router = useRouter();

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/dashboard");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center px-4 py-12">
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-8"
        style={{ boxShadow: "0 0 40px rgba(59,130,246,0.07)" }}
      >
        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <OrbitLogo />
          <h1 className="mt-3 text-xl font-bold text-white">Create your account</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Start planning your space missions
          </p>
        </div>

        {/* Auth0 signup button */}
        <a
          href="/auth/login?screen_hint=signup"
          className="flex items-center justify-center gap-2.5 w-full py-2.5 rounded-lg font-semibold text-white text-sm transition-all mb-3 cursor-pointer no-underline text-center"
          style={{
            background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
            boxShadow: "0 0 16px rgba(59,130,246,0.3)",
            border: "none",
          }}
        >
          Create Account
        </a>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[var(--text-muted)]">
          Already have an account?{" "}
          <a
            href="/auth/login"
            className="text-[var(--accent-glow)] hover:underline font-medium cursor-pointer bg-transparent border-none p-0 text-xs inline"
          >
            Sign in
          </a>
        </p>

        <p className="mt-3 text-center text-[10px] text-[var(--text-muted)]">
          Powered by Auth0. Supports email, Google, and GitHub.
        </p>
      </div>
    </div>
  );
}
