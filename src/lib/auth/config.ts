import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { INVITE_COOKIE } from '@/lib/auth/invite-cookie'
import { applyInvite, claimInvite } from '@/server/invites'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
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

      // Yeni kullanıcı: davet BURADA sahiplenilir, sonraki isteğe bırakılmaz.
      // Sadece doğrulayıp geçmek, aynı linkin sınırsız hesap açmasına yol
      // açar: kullanıcı satırı bu callback true dönünce oluşur ve bir daha
      // hiç davet kontrolünden geçmez.
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
     * `signIn` daveti sahiplendi ama kullanıcı henüz yoktu. Satır oluşunca
     * rol ve kanal üyeliği burada bağlanır. Sahiplenme başarısız olsaydı
     * bu noktaya hiç gelinmezdi.
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
      await applyInvite(invite.id, user.id)
    },
  },
})
