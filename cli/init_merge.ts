
#!/usr/bin/env -S deno run -A
import { exists } from "https://deno.land/std@0.224.0/fs/exists.ts";
async function writeIfMissing(p: string, s: string) { if (await exists(p)) return; await Deno.writeTextFile(p, s); }
await writeIfMissing(".gitattributes", `*.jsonl merge=jsonl-merge
`);
await writeIfMissing(".gitconfig.merge-jsonl", `[merge "jsonl-merge"]
	name = JSONL line-wise merge
	driver = bash scripts/merge-jsonl.sh %O %A %B %A
`);
console.log("Add to .git/config:\n[include]\n\tpath = .gitconfig.merge-jsonl");
