import btch from "btch-downloader";
async function test() {
    const res = await btch.youtube("https://www.youtube.com/watch?v=kffacxfA7G4");
    console.log(JSON.stringify(res, null, 2));
}
test();
