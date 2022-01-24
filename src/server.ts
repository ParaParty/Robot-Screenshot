import "cross-fetch/polyfill";
import { Builder, By, Capabilities, until } from "selenium-webdriver";
import * as grpc from "@grpc/grpc-js";
import {
  IScreenshotServer,
  ScreenshotService,
} from "../protos/protos/grpc_grpc_pb";
import { ScreenshotResult } from "../protos/protos/grpc_pb";

const capabilities = Capabilities.firefox();

async function buildDriver() {
  while (true) {
    try {
      const res = await fetch("http://selenium:4444/wd/hub/status");
      if (!res) {
        throw undefined;
      }
      const red = await res.json();
      if (!red.value.ready) {
        console.log(red.value.message);
        console.log(JSON.stringify(red.value));
        throw undefined;
      }
      break;
    } catch (e) {
      console.log("selenium is not ready, retry in 1s");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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

async function buildDriverLocal() {
  const driver = await new Builder().forBrowser("firefox").build();

  await driver.manage().window().setRect({
    x: 0,
    y: 0,
    width: 1024,
    height: 768,
  });

  return driver;
}

async function process(did: string): Promise<Uint8Array> {
  const driver = await buildDriver();
  const log = (t: string) => {
    console.log(`[${did}] ${t}`);
  };
  try {
    log("navigating");
    await driver.get(`https://t.bilibili.com/${did}?tab=3`);
    log("page loaded");

    // wait until card is loaded
    const card = await driver.wait(
      until.elementLocated(By.css(`.card[data-did="${did}"]`)),
      5000
    );
    log("card loaded");

    // wait until avatar is located
    await driver.wait(until.elementLocated(By.css(`#dynamicId_${did}`)), 2000);
    log("avatar located");

    // wait until all images are loaded
    await driver.executeAsyncScript(
      function () {
        // const did: string = arguments[0];
        const card: HTMLDivElement = arguments[1];
        const callback = arguments[arguments.length - 1];
        const images = Array.from(
          card.querySelectorAll<HTMLImageElement>("img")
        );
        console.log(images);

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
          else {
            img.addEventListener("load", finishOne);
            img.addEventListener("error", finishOne);
          }
        });
      },
      did,
      card
    );
    log("images loaded");

    await driver.executeScript(function () {
      const card: HTMLDivElement = arguments[0];
      // clear border
      card.style.border = "none";
      // make comment box invisible
      const commentbox = card.querySelector<HTMLDivElement>(".panel-area")!;
      commentbox.style.display = "none";
      // make share button invisible
      const bottonAera = card.querySelector<HTMLDivElement>(".button-area")!;
      bottonAera.style.display = "none";

      // make login box invisible
      const style = document.createElement("style");
      style.innerHTML = `
        .van-popover.van-popper {
          display: none !important;
        }
        .login-tip {
          display: none !important;
        }
      `;
      document.head.appendChild(style);

      // scale up
      document.body.style.scale = "1.5";
    }, card);
    log("ready to take screenshot");

    const screenshot = await card.takeScreenshot();
    log("screenshot taken");

    return Buffer.from(screenshot, "base64");
  } finally {
    await driver.quit();
    log("driver cleaned up");
  }
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
        console.log(`[${call.request.getDynamicid()}] failed with error: `, e);
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
