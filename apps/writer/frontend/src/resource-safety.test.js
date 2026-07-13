import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCustomBackgroundSource,
  normalizeEmbedWidth,
  normalizeImageSource,
  normalizeMediaSource,
  toSafeCssImageUrl,
} from "./resource-safety.js";

const TOKEN = "11111111-1111-4111-8111-111111111111";

test("accepts registered-protocol-shaped staged and document resource URLs", () => {
  assert.equal(
    normalizeImageSource(`paperwriter-asset://staged/${TOKEN}`),
    `paperwriter-asset://staged/${TOKEN}`,
  );
  assert.equal(
    normalizeImageSource(`paperwriter-asset://document/${TOKEN}?asset=assets%2Fimage-0001.png`),
    `paperwriter-asset://document/${TOKEN}?asset=assets%2Fimage-0001.png`,
  );
  assert.equal(
    normalizeMediaSource(`paperwriter-asset://document/${TOKEN}?asset=assets%2Fmedia-0001.mp4`, "video"),
    `paperwriter-asset://document/${TOKEN}?asset=assets%2Fmedia-0001.mp4`,
  );
});

test("rejects forged protocols, traversal, extra query fields and remote URLs", () => {
  const rejected = [
    "https://attacker.example/pixel.png",
    "file:///C:/secret.png",
    "javascript:alert(1)",
    `paperwriter-asset://staged/${TOKEN}?probe=1`,
    `paperwriter-asset://staged/${TOKEN}/extra`,
    `paperwriter-asset://document/${TOKEN}?asset=..%2Fsecret.png`,
    `paperwriter-asset://document/${TOKEN}?asset=assets%2Fimage.png&extra=1`,
    `paperwriter-asset://unknown/${TOKEN}`,
  ];
  rejected.forEach((source) => assert.equal(normalizeImageSource(source), "", source));
});

test("keeps capability-scoped runtime blob URLs without persisting arbitrary blob syntax", () => {
  assert.equal(
    normalizeImageSource(`blob:http://127.0.0.1:5174/${TOKEN}`),
    `blob:http://127.0.0.1:5174/${TOKEN}`,
  );
  assert.equal(normalizeMediaSource(`blob:null/${TOKEN}`, "audio"), `blob:null/${TOKEN}`);
  assert.equal(normalizeImageSource("blob:https://attacker.example/not-an-object-token"), "");
  assert.equal(normalizeImageSource(`blob:null/${TOKEN}\");background:red`), "");
});

test("accepts only matching, valid base64 data resource types", () => {
  assert.equal(normalizeImageSource("data:image/png;base64,QUJDRA=="), "data:image/png;base64,QUJDRA==");
  assert.equal(normalizeImageSource("data:image/png;base64,QUI"), "data:image/png;base64,QUI=");
  assert.equal(normalizeMediaSource("data:audio/mpeg;base64,QUJDRA==", "audio"), "data:audio/mpeg;base64,QUJDRA==");
  assert.equal(normalizeMediaSource("data:video/mp4;base64,QUJDRA==", "video"), "data:video/mp4;base64,QUJDRA==");
  assert.equal(normalizeImageSource("data:text/html;base64,QUJDRA=="), "");
  assert.equal(normalizeMediaSource("data:image/png;base64,QUJDRA==", "audio"), "");
  assert.equal(normalizeMediaSource("data:audio/mpeg;base64,QUJDRA==", "video"), "");
  assert.equal(normalizeImageSource("data:image/png;base64,QUJD\"RA=="), "");
});

test("allows only safe, type-matching relative document assets", () => {
  assert.equal(normalizeImageSource("assets/image-0001.png"), "assets/image-0001.png");
  assert.equal(normalizeImageSource("./assets/image-0001.svg"), "assets/image-0001.svg");
  assert.equal(normalizeMediaSource("assets/media-0001.ogg", "audio"), "assets/media-0001.ogg");
  assert.equal(normalizeMediaSource("assets/media-0001.webm", "video"), "assets/media-0001.webm");
  assert.equal(normalizeImageSource("assets/../secret.png"), "");
  assert.equal(normalizeImageSource("assets/image.png\");background:url(https://attacker.example/x)"), "");
  assert.equal(normalizeMediaSource("assets/movie.mp4", "audio"), "");
});

test("normalizes width and legacy custom backgrounds at CSS boundaries", () => {
  assert.equal(normalizeEmbedWidth("62%"), "62%");
  assert.equal(normalizeEmbedWidth("calc(100% + 100px)"), "78%");
  assert.equal(normalizeEmbedWidth("100%;background:red"), "78%");
  assert.equal(normalizeCustomBackgroundSource("data:image/gif;base64,R0lGODlhAQABAAAAACw="), "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
  assert.equal(normalizeCustomBackgroundSource("https://attacker.example/background.png"), "");
  assert.equal(toSafeCssImageUrl("assets/image-0001.png"), "url(\"assets/image-0001.png\")");
  assert.equal(toSafeCssImageUrl("x\");color:red"), "");
});
