import fs from "fs";
const data = fs.readFileSync("server.ts", "utf-8");
console.log(data.match(/app\.use\(express\.json.*\)/)?.[0]);
