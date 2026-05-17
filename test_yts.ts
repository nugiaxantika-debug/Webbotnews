import btch from "btch-downloader";
async function test() {
    const search = await btch.yts("justin bieber baby");
    console.log(JSON.stringify(search, null, 2));
}
test();
