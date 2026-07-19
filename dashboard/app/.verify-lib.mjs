import { createClient } from '@supabase/supabase-js'; import { readFileSync } from 'node:fs';
export const PW=readFileSync('/tmp/s11_pw.txt','utf8').trim();
export async function asRole(email){const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const {data,error}=await sb.auth.signInWithPassword({email,password:PW}); if(error)throw new Error(email+': '+error.message); return {sb,user:data.user};}
export const CS='claude-verify-cs@example.invalid'; export const EDITOR='claude-verify-editor@example.invalid';
