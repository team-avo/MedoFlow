-- Demo feedback WS1 — simplified patient booking.
--
-- 1. User.phone: the patient's contact number, filled at sign-up or the first
--    booking and auto-filled afterwards. Field-encrypted by the application
--    (utils/fieldCrypto ENCRYPTED_FIELDS.User.phone), so it is TEXT here.
-- 2. AuthHandoffCode: one-time codes that carry a signed-in patient's session
--    from the app host to a clinic's own domain. Only the sha256 of a code is
--    stored; a code lives 60 s, is single-use and is bound to one origin.
--    No clinicId column: like RefreshToken it is an auth primitive, and the
--    app role reaches it through the schema's default privileges.

ALTER TABLE "User" ADD COLUMN "phone" TEXT;

CREATE TABLE "AuthHandoffCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthHandoffCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthHandoffCode_codeHash_key" ON "AuthHandoffCode"("codeHash");
CREATE INDEX "AuthHandoffCode_userId_idx" ON "AuthHandoffCode"("userId");
CREATE INDEX "AuthHandoffCode_expiresAt_idx" ON "AuthHandoffCode"("expiresAt");

ALTER TABLE "AuthHandoffCode" ADD CONSTRAINT "AuthHandoffCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
