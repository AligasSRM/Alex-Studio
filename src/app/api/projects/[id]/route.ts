import { NextRequest, NextResponse } from "next/server";
import { getProject, deleteProject, updateProject, getProjectFiles } from "@/lib/projectOps";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const files = getProjectFiles(id);
  return NextResponse.json({ project, files });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description } = body;

    const updated = updateProject(id, { name, description });
    if (!updated) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const deleted = deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: "Project not found or could not be deleted" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id });
}
