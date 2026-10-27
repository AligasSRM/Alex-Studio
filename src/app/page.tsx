import Link from "next/link";

const tools = [
  {
    title: "Projects",
    description: "Create projects, inspect their files, and open a project workspace.",
    href: "/projects",
    action: "Open projects",
  },
  {
    title: "AI Chat",
    description: "Describe a change or ask for a plan. Real provider access requires configuration.",
    href: "/chat",
    action: "Open AI chat",
  },
  {
    title: "HTML Preview",
    description: "Experiment with HTML in a sandboxed iframe before adding it to a project.",
    href: "/preview",
    action: "Open preview",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Local development workspace</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Alex Studio</h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Build and review project changes with explicit approval, file backups, and verification.
            </p>
          </div>
          <Link href="/projects" className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
            View projects
          </Link>
        </header>

        <section className="mt-8 grid gap-4 md:grid-cols-3" aria-label="Workspace tools">
          {tools.map((tool) => (
            <article key={tool.href} className="flex min-h-56 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">{tool.title}</h2>
              <p className="mt-3 flex-1 leading-6 text-slate-600">{tool.description}</p>
              <Link href={tool.href} className="mt-5 inline-flex w-fit rounded-lg border border-slate-300 px-4 py-2 font-medium hover:border-blue-700 hover:text-blue-700">
                {tool.action} →
              </Link>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-950">Review before applying</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            File edits should be reviewed against the current file. Alex Studio checks the original hash before applying a proposed change and verifies the saved content afterward. Keep the app bound to localhost; it is not yet an authenticated multi-user service.
          </p>
        </section>
      </div>
    </main>
  );
}
