import fs from "node:fs";
const files = process.argv.slice(2);
for (const p of files) {
  let s = fs.readFileSync(p, "utf8");
  s = s.replaceAll("<motion", "<div");
  s = s.replaceAll("</motion>", "</div>");
  fs.writeFileSync(p, s);
  console.log("fixed", p);
}
