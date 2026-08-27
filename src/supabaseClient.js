import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Faltan las variables VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Configuralas en Vercel y en .env.local"
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "");
