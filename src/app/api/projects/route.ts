import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/projectOps";

export async function GET() {
  try {
    const projects = listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }

    const { name, description } = body as { name?: unknown; description?: unknown };
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }
    if (name.trim().length > 100) {
      return NextResponse.json({ error: "Project name must be 100 characters or fewer" }, { status: 400 });
    }
    if (description !== undefined && (typeof description !== "string" || description.length > 1000)) {
      return NextResponse.json({ error: "Project description must be text of at most 1000 characters" }, { status: 400 });
    }

    const project = createProject(name.trim(), typeof description === "string" ? description.trim() : undefined);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
