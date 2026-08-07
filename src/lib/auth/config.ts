import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'

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
      return true // yeni kullanıcı kontrolü davet akışında yapılır
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
})
