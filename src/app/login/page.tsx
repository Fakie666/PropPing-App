import { getCurrentUser, loginWithPassword } from "@/lib/auth";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

async function loginAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const result = await loginWithPassword(email, password);
  if (!result.ok) {
    redirect("/login?error=invalid");
  }

  redirect("/dashboard");
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  const error = searchParams?.error;

  return (
    <main className="main">
      <section className="panel login-card">
        <h2>PropPing Login</h2>
        <p className="muted">Demo account is seeded in Stage 1.</p>
        {error ? <p className="error">Login failed. Check your email and password.</p> : null}

        <form className="grid" action={loginAction}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </section>
    </main>
  );
}
