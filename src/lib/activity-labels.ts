/**
 * `Activity.verb` veritabanında plandaki (satır 2671) İngilizce, makine
 * okunur biçimiyle saklanır — bu değişmez, plan bunu açıkça şart koşuyor.
 * Ama ana sayfanın akışı bu ham değeri doğrudan kullanıcıya bastırıyordu
 * ("channel.memberAdded" gibi), ki bu projenin Türkçe-arayüz kısıtını ihlal
 * eder (final review Minor-2). Çelişki, Türkçe kısıtı lehine çözülür:
 * SAKLANAN değer İngilizce kalır, GÖSTERİLEN değer bu sözlükten geçer.
 *
 * Yeni bir verb eklenip buraya karşılığı eklenmezse kullanıcı ham İngilizce
 * yerine genel bir Türkçe yedek metin görür — asla İngilizce sızmaz, ama
 * yine de bu sözlüğün her yeni verb ile güncellenmesi gerekir.
 */
const activityVerbLabels: Record<string, string> = {
  'channel.created': 'bir kanal oluşturdu',
  'channel.memberAdded': 'kanala bir üye ekledi',
  'channel.memberRemoved': 'kanaldan bir üye çıkardı',
  'member.joined': 'kulübe katıldı',
  'member.deactivated': 'bir üyeyi pasifleştirdi',
  'member.reactivated': 'bir üyeyi yeniden etkinleştirdi',
  'member.roleChanged': 'bir üyenin rolünü değiştirdi',
  'invite.created': 'bir davet oluşturdu',
  'invite.revoked': 'bir daveti iptal etti',
  'invite.accepted': 'bir daveti kabul etti',
}

export function describeActivityVerb(verb: string): string {
  return activityVerbLabels[verb] ?? 'bilinmeyen bir işlem yaptı'
}
