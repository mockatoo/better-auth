import { MOCKATOO_URL, mockGitHub } from "@mockatoo/connect-better-auth";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { runClient, setup } from "./utils";

// Real GitHub can't sign in from CI, so the `github` provider points at
// Mockatoo, a hosted mock of GitHub's OAuth endpoints. Better Auth's own
// GitHub provider still builds the authorization URL, exchanges the code and
// maps the profile.
const email = process.env.MOCKATOO_TEST_EMAIL;
const password = process.env.MOCKATOO_TEST_PASSWORD;

const { ref, start, clean } = setup({
	// The server listens on a random port, so derive the callback URL from the
	// request host.
	baseURL: {
		allowedHosts: ["localhost:*"],
		protocol: "http",
		fallback: "http://localhost:3000",
	},
	plugins: [mockGitHub()],
});

test.describe("social sign-in", () => {
	test.beforeEach(async () => start());
	test.afterEach(async ({}, testInfo) => clean(testInfo));

	async function startGitHubSignIn(page: Page) {
		const appURL = `http://localhost:${ref.clientPort}/?port=${ref.serverPort}`;
		await page.goto(appURL);
		await page.locator("text=Ready").waitFor();
		const { data } = await runClient(page, ({ client }) =>
			client.signIn.social({
				provider: "github",
				callbackURL: window.location.href,
				disableRedirect: true,
			}),
		);
		const authorizeURL = new URL(data?.url ?? "");
		expect(authorizeURL.searchParams.get("redirect_uri")).toBe(
			`http://localhost:${ref.serverPort}/api/auth/callback/github`,
		);
		await page.goto(authorizeURL.href);
		return appURL;
	}

	test("redirects to the provider's login page", async ({ page }) => {
		await startGitHubSignIn(page);
		expect(new URL(page.url()).origin).toBe(new URL(MOCKATOO_URL).origin);
		await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
	});

	test("signs in with GitHub and creates a session", async ({ page }) => {
		test.skip(
			!email || !password,
			"Set MOCKATOO_TEST_EMAIL and MOCKATOO_TEST_PASSWORD to run the full sign-in.",
		);
		const appURL = await startGitHubSignIn(page);
		await page.getByLabel("Email", { exact: true }).fill(email ?? "");
		await page.getByLabel("Password", { exact: true }).fill(password ?? "");
		await page.getByRole("button", { name: "Log in with password" }).click();
		await page.getByRole("button", { name: "Authorize" }).click();

		await page.waitForURL(appURL);
		await page.locator("text=Ready").waitFor();
		const session = await runClient(page, ({ client }) => client.getSession());
		expect(session.data?.user.email).toBe(email);
	});
});
