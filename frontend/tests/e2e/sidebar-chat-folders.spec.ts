import { expect, test, type Locator, type Page } from "@playwright/test";

import { mockLangGraphAPI, THREAD_FOLDER_METADATA_KEY } from "./utils/mock-api";

// Fork feature: folders in the sidebar chat tree. These tests drive the
// user-facing behaviour — create a folder from the `+` in the group header,
// drag a conversation into it, confirm the conversation is inside the folder
// and *no longer* outside it, collapse/expand with the disclosure arrow, rename
// and delete from the folder's own options menu, and reload to prove the folder
// came from the per-user store rather than component state.
//
// Native HTML5 drag-and-drop is driven directly (one shared DataTransfer across
// the source's dragstart and the target's dragover/drop) because Playwright's
// mouse-based `dragTo` does not fire the DnD events these handlers listen for.

const FIRST_THREAD_ID = "00000000-0000-0000-0000-000000000801";
const SECOND_THREAD_ID = "00000000-0000-0000-0000-000000000802";

const THREADS = [
  {
    thread_id: FIRST_THREAD_ID,
    title: "Quarterly report",
    updated_at: "2026-07-04T10:00:00Z",
  },
  {
    thread_id: SECOND_THREAD_ID,
    title: "Holiday planning",
    updated_at: "2026-07-03T10:00:00Z",
  },
];

async function html5DragAndDrop(page: Page, source: Locator, target: Locator) {
  const sourceHandle = await source.elementHandle();
  const targetHandle = await target.elementHandle();
  if (!sourceHandle || !targetHandle) {
    throw new Error("drag source or target element not found");
  }
  await page.evaluate(
    ({ sourceEl, targetEl }) => {
      const dataTransfer = new DataTransfer();
      const fire = (element: Element, type: string) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
        element.dispatchEvent(event);
      };
      fire(sourceEl, "dragstart");
      fire(targetEl, "dragenter");
      fire(targetEl, "dragover");
      fire(targetEl, "drop");
      fire(sourceEl, "dragend");
    },
    { sourceEl: sourceHandle, targetEl: targetHandle },
  );
}

const sidebar = (page: Page) => page.locator("[data-sidebar='sidebar']");
const chatRow = (page: Page, threadId: string) =>
  sidebar(page).locator(`a[href$='${threadId}']`);
const folderRow = (page: Page, name: string) =>
  page.getByTestId("chat-folder-row").filter({ hasText: name });

async function createFolder(page: Page, name: string) {
  await page.getByTestId("chat-folder-create").click();
  await page.getByTestId("chat-folder-name-input").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(folderRow(page, name)).toBeVisible();
}

async function openFolderMenu(page: Page, name: string) {
  const row = folderRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
}

test.describe("Sidebar chat folders", () => {
  // The `+` is the only way into the feature, so where it sits *is* the
  // feature's front door. Parked at the far right edge of the sidebar, a
  // borderless 16px icon a hundred and fifty pixels from the words it belongs
  // to reads as chrome, and a reader who looks beside "Recent chats" finds
  // nothing there. Geometry is the property — being in the DOM is not being
  // findable — so this measures the gap rather than asserting a class.
  test("the new-folder button sits beside the group's label", async ({
    page,
  }) => {
    mockLangGraphAPI(page, { threads: THREADS });
    await page.goto("/workspace/chats/new");
    await expect(chatRow(page, FIRST_THREAD_ID)).toBeVisible({
      timeout: 15_000,
    });

    const button = page.getByTestId("chat-folder-create");
    await expect(button).toBeVisible();
    const labelBox = await page.getByTestId("recent-chats-label").boundingBox();
    const buttonBox = await button.boundingBox();
    if (!labelBox || !buttonBox) {
      throw new Error("the group label or its create button has no box");
    }

    const gap = buttonBox.x - (labelBox.x + labelBox.width);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(24);
    const centreOffset = Math.abs(
      buttonBox.y + buttonBox.height / 2 - (labelBox.y + labelBox.height / 2),
    );
    expect(centreOffset).toBeLessThan(4);
  });

  // The group used to render nothing at all until a conversation existed, so
  // the one control that creates a folder was missing on exactly the workspace
  // where someone would first go looking for it.
  test("a folder can be created before there are any conversations", async ({
    page,
  }) => {
    mockLangGraphAPI(page, { threads: [] });
    await page.goto("/workspace/chats/new");

    await createFolder(page, "Work");
    await expect(page.getByTestId("chat-folder-count")).toHaveText("0");
  });

  test("a chat dragged into a folder lives inside it and nowhere else", async ({
    page,
  }) => {
    mockLangGraphAPI(page, { threads: THREADS });
    await page.goto("/workspace/chats/new");
    await expect(chatRow(page, FIRST_THREAD_ID)).toBeVisible({
      timeout: 15_000,
    });

    await createFolder(page, "Work");

    await html5DragAndDrop(
      page,
      chatRow(page, FIRST_THREAD_ID),
      folderRow(page, "Work"),
    );

    // Inside the folder…
    const children = page.getByTestId("chat-folder-children");
    await expect(
      children.locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
    // …and, the whole point of the feature, no longer in the list outside it.
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toHaveCount(0);
    // The chat that was not dragged stays where it was.
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${SECOND_THREAD_ID}']`),
    ).toBeVisible();
    await expect(page.getByTestId("chat-folder-count")).toHaveText("1");
  });

  test("the disclosure arrow hides and shows the chats in a folder", async ({
    page,
  }) => {
    mockLangGraphAPI(page, { threads: THREADS });
    await page.goto("/workspace/chats/new");
    await expect(chatRow(page, FIRST_THREAD_ID)).toBeVisible({
      timeout: 15_000,
    });

    await createFolder(page, "Work");
    await html5DragAndDrop(
      page,
      chatRow(page, FIRST_THREAD_ID),
      folderRow(page, "Work"),
    );
    await expect(page.getByTestId("chat-folder-children")).toBeVisible();

    // Collapse: the chat is hidden, but the folder still reports it.
    await folderRow(page, "Work").getByRole("button").first().click();
    await expect(page.getByTestId("chat-folder-children")).toHaveCount(0);
    await expect(page.getByTestId("chat-folder-count")).toHaveText("1");
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toHaveCount(0);

    // Expand again.
    await folderRow(page, "Work").getByRole("button").first().click();
    await expect(
      page
        .getByTestId("chat-folder-children")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
  });

  test("a chat dragged back to the list leaves its folder", async ({
    page,
  }) => {
    mockLangGraphAPI(page, {
      threads: [
        {
          ...THREADS[0]!,
          metadata: { [THREAD_FOLDER_METADATA_KEY]: "folder-seed" },
        },
        THREADS[1]!,
      ],
      chatFolders: [{ id: "folder-seed", name: "Work" }],
    });
    await page.goto("/workspace/chats/new");
    await expect(folderRow(page, "Work")).toBeVisible({ timeout: 15_000 });

    // Seeded folders start collapsed (the expanded set is per browser), so open
    // it to reach the chat inside.
    await folderRow(page, "Work").getByRole("button").first().click();
    const filedChat = page
      .getByTestId("chat-folder-children")
      .locator(`a[href$='${FIRST_THREAD_ID}']`);
    await expect(filedChat).toBeVisible();

    await html5DragAndDrop(page, filedChat, page.getByTestId("chat-root-list"));

    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
    await expect(page.getByTestId("chat-folder-count")).toHaveText("0");
  });

  test("rename and delete live in the folder's own options menu", async ({
    page,
  }) => {
    mockLangGraphAPI(page, {
      threads: [
        {
          ...THREADS[0]!,
          metadata: { [THREAD_FOLDER_METADATA_KEY]: "folder-seed" },
        },
        THREADS[1]!,
      ],
      chatFolders: [{ id: "folder-seed", name: "Work" }],
    });
    await page.goto("/workspace/chats/new");
    await expect(folderRow(page, "Work")).toBeVisible({ timeout: 15_000 });

    await openFolderMenu(page, "Work");
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByTestId("chat-folder-name-input").fill("Archive");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(folderRow(page, "Archive")).toBeVisible();

    await openFolderMenu(page, "Archive");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByTestId("chat-folder-row")).toHaveCount(0);
    // Deleting a folder never deletes the conversations in it.
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
  });

  test("folders and their contents survive a reload", async ({ page }) => {
    mockLangGraphAPI(page, { threads: THREADS });
    await page.goto("/workspace/chats/new");
    await expect(chatRow(page, FIRST_THREAD_ID)).toBeVisible({
      timeout: 15_000,
    });

    await createFolder(page, "Work");
    await html5DragAndDrop(
      page,
      chatRow(page, FIRST_THREAD_ID),
      folderRow(page, "Work"),
    );
    await expect(page.getByTestId("chat-folder-count")).toHaveText("1");

    await page.reload();

    await expect(folderRow(page, "Work")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("chat-folder-count")).toHaveText("1");
    // A folder the user just created stays open across the reload; the chat is
    // still inside it and still not in the root list.
    await expect(
      page
        .getByTestId("chat-folder-children")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toHaveCount(0);
  });

  test("the row menu's New folder files the chat it was opened from", async ({
    page,
  }) => {
    // **Move to folder ▸ New folder** reads as one action. Creating the folder
    // and leaving the conversation where it was is the silent half-failure this
    // covers: the folder appears, so nothing looks broken.
    mockLangGraphAPI(page, { threads: THREADS });
    await page.goto("/workspace/chats/new");
    await expect(chatRow(page, FIRST_THREAD_ID)).toBeVisible({
      timeout: 15_000,
    });

    const row = chatRow(page, FIRST_THREAD_ID).locator("xpath=..");
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to folder" }).click();
    await page.getByRole("menuitem", { name: "New folder" }).click();
    await page.getByTestId("chat-folder-name-input").fill("Work");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(folderRow(page, "Work")).toBeVisible();
    await expect(
      page
        .getByTestId("chat-folder-children")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toHaveCount(0);
    await expect(page.getByTestId("chat-folder-count")).toHaveText("1");
    // The chat that was not filed stays in the list.
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${SECOND_THREAD_ID}']`),
    ).toBeVisible();
  });

  test("the row menu files a chat without a drag", async ({ page }) => {
    mockLangGraphAPI(page, {
      threads: THREADS,
      chatFolders: [{ id: "folder-seed", name: "Work" }],
    });
    await page.goto("/workspace/chats/new");
    await expect(chatRow(page, FIRST_THREAD_ID)).toBeVisible({
      timeout: 15_000,
    });

    const row = chatRow(page, FIRST_THREAD_ID).locator("xpath=..");
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to folder" }).click();
    await page.getByRole("menuitem", { name: "Work" }).click();

    await expect(
      page
        .getByTestId("chat-folder-children")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("chat-root-list")
        .locator(`a[href$='${FIRST_THREAD_ID}']`),
    ).toHaveCount(0);
  });
});
