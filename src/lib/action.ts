import type { z } from 'zod'
import { unstable_rethrow } from 'next/navigation'
import { fail, ok, type Result } from '@/lib/result'
import type { Actor } from '@/lib/auth/policy'
import type { ErrorCode } from '@/lib/errors'

type AuthorizeOutcome =
  | { allowed: true }
  | { allowed: false; code?: Extract<ErrorCode, 'FORBIDDEN' | 'NOT_FOUND'> }

type Definition<TSchema extends z.ZodTypeAny, TOut> = {
  input: TSchema
  getActor: () => Promise<Actor | null>
  authorize: (ctx: { actor: Actor; input: z.infer<TSchema> }) => Promise<AuthorizeOutcome>
  handler: (ctx: { actor: Actor; input: z.infer<TSchema> }) => Promise<TOut>
}

/**
 * Handler'ın kod taşıyan hata bildirmesinin tek yolu. `throw actionError(...)`
 * sarmalayıcıda yakalanır ve aynı kodla `Result` hatasına çevrilir.
 */
export class ActionError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly fields?: Record<string, string>,
  ) {
    super(code)
    this.name = 'ActionError'
  }
}

export function actionError(code: ErrorCode, fields?: Record<string, string>): ActionError {
  return new ActionError(code, fields)
}

export function defineAction<TSchema extends z.ZodTypeAny, TOut>(
  def: Definition<TSchema, TOut>,
): (raw: unknown) => Promise<Result<TOut>> {
  return async (raw: unknown) => {
    try {
      const parsed = def.input.safeParse(raw)
      if (!parsed.success) {
        const fields: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.') || '_'
          if (!fields[key]) fields[key] = issue.message
        }
        return fail('VALIDATION', fields)
      }

      const actor = await def.getActor()
      if (!actor) return fail('UNAUTHENTICATED')

      // Yetki kontrolü handler'dan ÖNCE. Bu sıra değiştirilemez.
      const decision = await def.authorize({ actor, input: parsed.data })
      if (!decision.allowed) return fail(decision.code ?? 'FORBIDDEN')

      return ok(await def.handler({ actor, input: parsed.data }))
    } catch (error) {
      // Next'in redirect() ve notFound() akışı throw ile çalışır; yutulursa
      // yönlendirme sessizce INTERNAL'a döner.
      unstable_rethrow(error)
      if (error instanceof ActionError) return fail(error.code, error.fields)
      console.error('[action] unhandled error', error)
      return fail('INTERNAL')
    }
  }
}
