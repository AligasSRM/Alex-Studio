export const runtime='nodejs';
import {NextResponse} from 'next/server';
import {getProject} from '@/lib/project-store';
import {readProjectFile} from '@/lib/files';
export async function GET(r:Request){
 const id=new URL(r.url).searchParams.get('projectId')||'',project=getProject(id);
 if(!project)return new NextResponse('Project not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
 let html='<!doctype html><html><body><h1>No index.html found</h1></body></html>',css='',js='';
 try{html=readProjectFile(id,'index.html');}catch{}
 try{css=readProjectFile(id,'styles.css');}catch{}
 try{js=readProjectFile(id,'script.js');}catch{}
 css=css.replace(/<\\/style/gi,'<\\\\/style');
 js=js.replace(/<\\/script/gi,'<\\\\/script');
 if(!/<html[\\s>]/i.test(html))html='<!doctype html><html><head></head><body>'+html+'</body></html>';
 if(!/<head[\\s>]/i.test(html))html=html.replace(/<html([^>]*)>/i,'<html$1><head></head>');
 if(css)html=html.replace(/<\\/head>/i,'<style>'+css+'</style></head>');
 if(js)html=html.replace(/<\\/body>/i,'<script>'+js+'</script></body>');
 return new NextResponse(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"}});
}