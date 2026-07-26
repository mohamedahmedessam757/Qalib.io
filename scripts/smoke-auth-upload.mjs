const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = `qalib.${Date.now()}@mailinator.com`;
const password = "QalibTest2026!";

async function main() {
  const supabase = createClient(url, anon);
  console.log("signup", email);
  const { data: sign, error: signErr } = await supabase.auth.signUp({
    email,
    password,
  });
  if (signErr) throw signErr;
  console.log("session?", Boolean(sign.session), "user", sign.user?.id);

  if (!sign.session) {
    const { data: login, error: loginErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (loginErr) throw loginErr;
    console.log("logged in after confirm requirement?", Boolean(login.session));
    if (!login.session) {
      console.log("BLOCKED: email confirmation required in Supabase Auth settings");
      process.exit(2);
    }
  }

  const user = (await supabase.auth.getUser()).data.user;
  await supabase.from("profiles").upsert({
    id: user.id,
    email,
    locale: "ar",
  });

  const filePath = path.join("public", "samples", "qalib-test.docx");
  const buf = fs.readFileSync(filePath);
  const id = `doc_${Date.now()}`;
  const storagePath = `${user.id}/${id}.docx`;

  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(storagePath, buf, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });
  if (upErr) throw upErr;
  console.log("storage upload ok", storagePath);

  const { error: insErr } = await supabase.from("documents").insert({
    id,
    owner_id: user.id,
    title: "qalib-test",
    storage_path: storagePath,
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byte_size: buf.length,
  });
  if (insErr) throw insErr;
  console.log("db insert ok", id);

  const { data: signed, error: signUrlErr } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 120);
  if (signUrlErr) throw signUrlErr;

  const res = await fetch(signed.signedUrl);
  console.log("download status", res.status, "bytes", (await res.arrayBuffer()).byteLength);

  const { data: list, error: listErr } = await supabase
    .from("documents")
    .select("id,title,byte_size")
    .eq("owner_id", user.id);
  if (listErr) throw listErr;
  console.log("list", list);
  console.log("PASS");
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
