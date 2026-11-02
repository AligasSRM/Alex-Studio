export const runtime='nodejs';
import {NextResponse} from 'next/server';
import {assertLocalMutation,assertLocalRequest} from '@/lib/path-security';
import {createProject,listProjects} from '@/lib/project-store';
import {WINDOWS_MUTATION_UNAVAILABLE} from '@/lib/platform-mutation';
export async function GET(r:Request){if(!assertLocalRequest(r))return NextResponse.json({error:'Local requests only'},{status:403});return NextResponse.json({projects:listProjects()},{headers:{'Cache-Control':'no-store'}});}
export async function POST(r:Request){if(!assertLocalMutation(r))return NextResponse.json({error:'Local same-origin requests only'},{status:403});return NextResponse.json({error:WINDOWS_MUTATION_UNAVAILABLE},{status:503,headers:{'Cache-Control':'no-store'}});}
