import { beforeEach, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
const fake = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  single: vi.fn(),
  callback: null as null | ((event: string, session: unknown) => void),
}));
vi.mock("../src/shared/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: fake.signIn,
      signUp: fake.signUp,
      signOut: fake.signOut,
      verifyOtp: fake.verifyOtp,
      resend: fake.resend,
      onAuthStateChange: (callback: typeof fake.callback) => {
        fake.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: fake.single }) }) }),
  },
}));
vi.mock("../src/core/crypto/vaultCrypto", async (original) => {
  const module =
    await original<typeof import("../src/core/crypto/vaultCrypto")>();
  return {
    ...module,
    deriveAuthPassword: vi.fn(async () => "derived-auth-fixture"),
    deriveKey: vi.fn(async () => ({ type: "secret" })),
  };
});
import { useAuthStore } from "../src/features/auth/stores/useAuthStore";
import { useDownloadAuthStore } from "../src/features/vault/stores/useDownloadAuthStore";
const user = { id: "alice", email: "alice@example.test" } as User;
const session = { user, access_token: "fixture" } as Session;
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().cancelOtpFlow();
  useAuthStore.setState({ session: null, user: null, vaultKey: null });
  fake.signOut.mockResolvedValue({ error: null });
  fake.single.mockResolvedValue({
    data: { vault_salt: "ab".repeat(32) },
    error: null,
  });
});
it("never falls back to sending a master passphrase on Auth errors", async () => {
  fake.signIn.mockResolvedValue({ data: {}, error: new Error("offline") });
  await useAuthStore
    .getState()
    .signIn("alice@example.test", "master passphrase");
  expect(fake.signIn).toHaveBeenCalledExactlyOnceWith({
    email: "alice@example.test",
    password: "derived-auth-fixture",
  });
  expect(useAuthStore.getState().vaultKey).toBeNull();
});
it("does not restore a key when logout happens during key derivation", async () => {
  fake.signIn.mockResolvedValue({ data: { user, session }, error: null });
  let resolve!: (value: unknown) => void;
  fake.single.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = useAuthStore
    .getState()
    .signIn("alice@example.test", "master passphrase");
  await vi.waitFor(() => expect(fake.single).toHaveBeenCalled());
  await useAuthStore.getState().signOut();
  resolve({ data: { vault_salt: "ab".repeat(32) }, error: null });
  await pending;
  expect(useAuthStore.getState().vaultKey).toBeNull();
  expect(useAuthStore.getState().session).toBeNull();
});
it("clears second passwords and keys on a change of authenticated user", () => {
  const cleanup = useAuthStore.getState().initSession();
  useAuthStore.setState({ user, session, vaultKey: {} as CryptoKey });
  useDownloadAuthStore.getState().setDownloadSessionPassword("test secret");
  fake.callback?.("SIGNED_IN", { user: { id: "bob" } });
  expect(useAuthStore.getState().vaultKey).toBeNull();
  expect(useDownloadAuthStore.getState().downloadSessionPassword).toBeNull();
  cleanup();
});
it("clears authorization passwords on inactivity lock", () => {
  useAuthStore.setState({ user, session, vaultKey: {} as CryptoKey });
  useDownloadAuthStore.getState().setDownloadSessionPassword("test secret");
  useAuthStore.getState().lockVaultInMemory();
  expect(useAuthStore.getState().vaultKey).toBeNull();
  expect(useDownloadAuthStore.getState().downloadSessionPassword).toBeNull();
});
it("expires the registration passphrase while allowing email verification", async () => {
  vi.useFakeTimers();
  try {
    fake.signUp.mockResolvedValue({
      data: { user, session: null },
      error: null,
    });
    await useAuthStore
      .getState()
      .signUp("alice@example.test", "long registration passphrase");
    expect(useAuthStore.getState().isAwaitingOtp).toBe(true);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(useAuthStore.getState().tempRegistrationPassword).toBeNull();
    fake.verifyOtp.mockResolvedValue({ data: { user, session }, error: null });
    expect(await useAuthStore.getState().verifySignUpOtp("123456")).toBe(true);
    expect(useAuthStore.getState().vaultKey).toBeNull();
    expect(useAuthStore.getState().authSuccessMessage).toContain(
      "Cuenta confirmada",
    );
  } finally {
    vi.useRealTimers();
  }
});
