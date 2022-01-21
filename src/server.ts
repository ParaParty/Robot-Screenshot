import "cross-fetch/polyfill";
import {
  Builder,
  By,
  Capabilities,
  until,
  WebDriver,
} from "selenium-webdriver";
import * as grpc from "@grpc/grpc-js";
import {
  IScreenshotServer,
  ScreenshotService,
} from "../protos/protos/grpc_grpc_pb";
import { ScreenshotResult } from "../protos/protos/grpc_pb";

const capabilities = Capabilities.firefox();

async function buildDriver() {
  while (true) {
    const res = await fetch("http://selenium:4444/").catch(() => {
      console.log("connect to selenium failed, retry in 1s");
    });
    if (res?.status === 200) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("connecting to driver");

  const driver = await new Builder()
    .usingServer("http://selenium:4444/wd/hub")
    .withCapabilities(capabilities)
    .build();

  await driver.manage().window().setRect({
    x: 0,
    y: 0,
    width: 1024,
    height: 768,
  });

  console.log("driver is now available");

  return driver;
}

let _driver: Promise<WebDriver> | undefined = buildDriver();

async function process(did: string): Promise<Uint8Array> {
  const driver = await (_driver ?? buildDriver());
  try {
    await driver.get(`https://t.bilibili.com/${did}?tab=3`);

    // wait until card is loaded
    const card = await driver.wait(
      until.elementLocated(By.css(`.card[data-did="${did}"]`))
    );

    // wait until avatar is located
    await driver.wait(until.elementLocated(By.css(`#dynamicId_${did}`)));

    // wait until all images are loaded
    await driver.executeAsyncScript(function () {
      const did: string = arguments[0];
      const callback = arguments[arguments.length - 1];
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(".img-content")
      );

      images.push(
        document.querySelector<HTMLLinkElement>(`#dynamicId_${did}`)!
          .children[0].children[0] as HTMLImageElement
      );

      const buttonBar = document.querySelector(
        ".card .main-content .button-bar"
      );
      buttonBar?.childNodes.forEach((node) => {
        const span = (node as HTMLDivElement).children[0] as HTMLElement;
        if (span.tagName !== "SPAN") return;

        const i = span.children[0] as HTMLElement;
        const uri = window
          .getComputedStyle(i)
          .getPropertyValue("background-image");
        const url = uri.slice(5, -2);

        const img = new Image();
        img.src = url;
        images.push(img);
      });

      let loaded = 0;
      const finishOne = () => {
        loaded++;
        if (loaded === images.length) callback();
      };
      images.forEach((img) => {
        if (img.tagName !== "IMG") return finishOne();
        if (img.complete) finishOne();
        else img.addEventListener("load", finishOne);
      });
    }, did);

    await driver.executeScript(function () {
      // make comment box invisible
      const card: HTMLDivElement = arguments[0];
      const commentbox = card.querySelector<HTMLDivElement>(".panel-area")!;
      commentbox.style.display = "none";
      const bottonAera = card.querySelector<HTMLDivElement>(".button-area")!;
      bottonAera.style.display = "none";

      // make login box invisible
      const popovers = document.querySelectorAll<HTMLDivElement>(
        ".van-popover.van-popper"
      );
      popovers.forEach((popover) => {
        popover.style.display = "none";
      });

      // scale up
      document.body.style.scale = "1.5";
    }, card);

    // await driver.wait(
    //   until.elementIsNotVisible(
    //     driver.findElement(By.css(".van-popover.van-popper"))
    //   ),
    //   5000
    // );

    const screenshot = await card.takeScreenshot();

    // freeup memory
    await driver.get("about:blank");

    return Buffer.from(screenshot, "base64");
  } catch (e) {
    await driver.quit();
  }
  return Buffer.from([]);
}

let queue = Promise.resolve();

const server = new grpc.Server();

const screenshotService: IScreenshotServer = {
  shotBld(call, callback) {
    queue = queue.then(async () => {
      let res: Uint8Array;
      try {
        res = await process(call.request.getDynamicid());
      } catch (e) {
        res = Buffer.from([]);
      }
      const msg = new ScreenshotResult();
      msg.setPngimage(res);
      callback(null, msg);
    });
  },
};
server.addService(ScreenshotService, screenshotService);
server.bindAsync(
  "0.0.0.0:3000",
  grpc.ServerCredentials.createInsecure(),
  () => {
    server.start();
    console.log("Server listening on 0.0.0.0:3000");
  }
);
