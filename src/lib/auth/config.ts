import NextAuth, { type NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { INVITE_COOKIE } from '@/lib/auth/invite-cookie'
import { applyInvite, claimInvite } from '@/server/invite-service'

// Adaptör ayrı bir sabitte: hem NextAuth() yapılandırmasında kullanılır hem
// de testler `createUser`'ı Auth.js'in gerçekten çağırdığı şekilde —
// `@auth/core`'un adaptöre verdiği ham profille — tetikleyebilsin diye
// doğrudan export edilir (bkz. tests/integration/registration-flow.test.ts).
export const adapter = PrismaAdapter(db)

// `callbacks`/`events` ayrı bir `authConfig` sabitinde: testler `signIn` ve
// `createUser`'ı `vi.mock('@/lib/auth/config')` ARKASINA gizlemeden,
// gerçek DB'ye karşı doğrudan çağırabilsin diye export edilir. Bu satırda
// mock'lanan tek şey `next/headers`'ın `cookies()`'i (platform ilkeli) —
// modülün kendisi değil.
export const authConfig: NextAuthConfig = {
  adapter,
  session: { strategy: 'database' },
  // Hata sayfası da /login'e döner: Auth.js'in kendi hata ekranı İngilizcedir.
  pages: { signIn: '/login', error: '/login' },
  // Google, AUTH_GOOGLE_ID ve AUTH_GOOGLE_SECRET'ı ortamdan kendisi okur.
  // Değerleri elle geçirmek strict TS'te `string | undefined` hatası verir.
  providers: [Google],
  callbacks: {
    /**
     * Davet olmadan kimse giremez. Yeni kullanıcı yalnızca
     * /invite/[token] akışının kurduğu çerezle oluşturulabilir (Task 9).
     */
    async signIn({ user }) {
      if (!user.email) return false

      const existing = await db.user.findUnique({ where: { email: user.email } })
      if (existing) return existing.isActive

      // Yeni kullanıcı: davet BURADA rezerve edilir, sonraki isteğe
      // bırakılmaz. Sadece doğrulayıp geçmek, aynı linkin sınırsız hesap
      // açmasına yol açar. Rezervasyon KALICI değildir — `createUser` bu
      // callback'ten SONRA çalışır ve adaptör hatası ya da ağ kopması
      // yüzünden hiç tamamlanmayabilir; kalıcı tüketim `applyInvite`
      // içinde, `createUser` event'inde gerçekleşir (bkz. invite-service.ts).
      const store = await cookies()
      const token = store.get(INVITE_COOKIE)?.value
      if (!token) return false
      return claimInvite(hashInviteToken(token))
    },
    /**
     * Oturum yanıtı daraltılır. Ham adaptör satırı `sessionToken` içerir ve
     * `session` callback'i ne döndürürse /api/auth/session onu JSON olarak
     * yayınlar — token oradan sızarsa httpOnly çerezin anlamı kalmaz.
     */
    async session({ session, user }) {
      return {
        expires: session.expires,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      }
    },
  },
  events: {
    /**
     * `signIn` daveti rezerve etti ama kullanıcı henüz yoktu. Satır oluşunca
     * rol ve kanal üyeliği burada bağlanır VE rezervasyon kalıcı tüketime
     * çevrilir (`applyInvite` içinde `usedAt`). Rezervasyon başarısız olsaydı
     * bu noktaya hiç gelinmezdi.
     *
     * `applyInvite` burada BİLEREK try/catch içinde: Auth.js akışı
     * `createUser` → bu event → `linkAccount` → `createSession` şeklinde
     * ilerler ve hiçbiri korumalı değildir. Hata burada yutulmazsa kullanıcı
     * satırı hesabı bağlanmadan kalır; bir sonraki girişte Auth.js
     * `AccountNotLinked` fırlatır ve hesap kalıcı olarak kilitlenir. Rol/kanal
     * ataması yapılmamış ama giriş yapabilen bir kullanıcı adminin
     * düzeltebileceği bir durumdur; bağlanamayan bir hesap değildir.
     *
     * Not: bu hata durumunda davet kalıcı tüketilmemiş kalır (`usedAt` set
     * edilmez, transaction hiç commit olmaz) — rezervasyon TTL sonunda
     * kendiliğinden serbest kalır, davet yanmaz.
     */
    async createUser({ user }) {
      if (!user.id) return
      const store = await cookies()
      const token = store.get(INVITE_COOKIE)?.value
      if (!token) return
      const invite = await db.invite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
      })
      if (!invite || invite.usedByUserId) return
      try {
        const result = await applyInvite(invite.id, user.id)
        // `CONFLICT` artık gerçekten ulaşılabilir: rezervasyon TTL'i geçip
        // davet başka biri tarafından yeniden rezerve/tüketilmişse (bkz.
        // invite-service.ts `claimInvite`), bu geç kalmış çağrı burada elenir.
        if (!result.ok) {
          console.warn('[auth] davet uygulanamadı (rezervasyon TTL sonrası çakışma olabilir)', {
            inviteId: invite.id, userId: user.id, code: result.error.code,
          })
        }
      } catch (error) {
        console.error('[auth] davet uygulanamadı', { inviteId: invite.id, userId: user.id }, error)
      }
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
