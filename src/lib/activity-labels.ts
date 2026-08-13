import {
  Activity,
  CalendarDays,
  CheckSquare,
  FileText,
  Gift,
  Hash,
  Heart,
  MessageSquare,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

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
  'document.created': 'bir doküman oluşturdu',
  'document.updated': 'bir dokümanı güncelledi',
  'document.archived': 'bir dokümanı çöp kutusuna taşıdı',
  'document.restored': 'bir dokümanı geri yükledi',
  'document.permanentlyDeleted': 'bir dokümanı kalıcı olarak sildi',
  'document.shared': 'bir dokümanı paylaştı',
  'document.unshared': 'bir doküman paylaşımını kaldırdı',
  'comment.added': 'bir yorum yazdı',
  'task.created': 'bir görev oluşturdu',
  'task.updated': 'bir görevi güncelledi',
  'task.moved': 'bir görevi taşıdı',
  'task.assigned': 'bir görevin atamalarını değiştirdi',
  'task.linkedToEvent': 'bir görevi etkinliğe bağladı',
  'task.unlinkedFromEvent': 'bir görevin etkinlik bağlantısını kaldırdı',
  'task.archived': 'bir görevi arşivledi',
  'task.restored': 'bir görevi geri yükledi',
  'event.created': 'bir etkinlik oluşturdu',
  'event.updated': 'bir etkinliği güncelledi',
  'event.archived': 'bir etkinliği arşivledi',
  'event.restored': 'bir etkinliği geri yükledi',
  'sponsor.created': 'bir sponsor ekledi',
  'sponsor.updated': 'bir sponsoru güncelledi',
  'sponsor.moved': 'bir sponsorun durumunu değiştirdi',
  'sponsor.archived': 'bir sponsoru arşivledi',
  'sponsor.restored': 'bir sponsoru geri yükledi',
  'budget.created': 'bir bütçe kalemi ekledi',
  'budget.updated': 'bir bütçe kalemini güncelledi',
  'budget.archived': 'bir bütçe kalemini arşivledi',
}

export function describeActivityVerb(verb: string): string {
  return activityVerbLabels[verb] ?? 'bilinmeyen bir işlem yaptı'
}

/**
 * Verb ikonu neredeyse tamamen ad alanından (`verb`'in ilk parçası) türer, o
 * yüzden burada verb başına değil ad alanı başına eşleşme tutulur — yeni bir
 * verb eklendiğinde ikonu kendiliğinden gelir. Yalnızca aynı ad alanı içinde
 * anlamı ayrışan verb'ler `verbOverrides`'ta tek tek listelenir.
 */
const namespaceIcons: Record<string, LucideIcon> = {
  channel: Hash,
  member: Users,
  invite: Gift,
  document: FileText,
  comment: MessageSquare,
  task: CheckSquare,
  event: CalendarDays,
  sponsor: Heart,
  budget: Wallet,
}

const verbOverrides: Record<string, LucideIcon> = {
  'channel.memberAdded': UserPlus,
  'channel.memberRemoved': Users,
}

export function activityVerbIcon(verb: string): LucideIcon {
  return verbOverrides[verb] ?? namespaceIcons[verb.split('.')[0] ?? ''] ?? Activity
}
