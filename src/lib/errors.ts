export const errorMessages = {
  UNAUTHENTICATED: 'Giriş yapman gerekiyor.',
  FORBIDDEN: 'Bu işlem için yetkin yok.',
  NOT_FOUND: 'Kayıt bulunamadı.',
  VALIDATION: 'Girdiğin bilgilerde hata var.',
  CONFLICT: 'Bu işlem mevcut durumla çakışıyor.',
  INTERNAL: 'Beklenmeyen bir hata oldu. Tekrar dene.',
} as const

export type ErrorCode = keyof typeof errorMessages

export type AppError = {
  code: ErrorCode
  message: string
  fields?: Record<string, string>
}
