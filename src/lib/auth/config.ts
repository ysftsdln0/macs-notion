import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'

/**
 * E2E testleri için parolasız test provider'ı.
 * GÜVENLİK: yalnızca E2E_AUTH_BYPASS=1 iken derlenir/etkinleşir.
 * Bu değişken production imajında ASLA set edilmez; compose.yml'de yoktur
 * ve deploy workflow'u onu geçirmez. Yanlışlıkla açılırsa
 * herhangi biri istediği kullanıcı kimliğiyle oturum açabilir.
 */
const testProviders =
  process.env.E2E_AUTH_BYPASS === '1'
    ? [
        Credentials({
          id: 'e2e',
          name: 'E2E',
          credentials: { email: { label: 'email' } },
          authorize: async (creds) => {
            const email = typeof creds?.email === 'string' ? creds.email : null
            if (!email) return null
            return db.user.findUnique({ where: { email } })
          },
        }),
      ]
    : []

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'database' },
  pages: { signIn: '/login' },
  // Google, AUTH_GOOGLE_ID ve AUTH_GOOGLE_SECRET'ı ortamdan kendisi okur.
  // Değerleri elle geçirmek strict TS'te `string | undefined` hatası verir.
  providers: [Google, ...testProviders],
  callbacks: {
    /**
     * Davet olmadan kimse giremez. Yeni kullanıcı yalnızca
     * /invite/[token] akışının kurduğu çerezle oluşturulabilir (Task 9).
     */
    async signIn({ user, account }) {
      if (account?.provider === 'e2e') return true
      if (!user.email) return false
      const existing = await db.user.findUnique({ where: { email: user.email } })
      if (existing) return existing.isActive
      return true // yeni kullanıcı kontrolü davet akışında yapılır
    },
    async session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
})
