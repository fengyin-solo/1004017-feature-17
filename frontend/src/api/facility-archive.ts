import { listRows, reloadCache, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  ArchiveAttachment,
  ArchivePackage,
  ArchiveVersion,
  EntryRow,
  FacilityArchiveRow,
  OperatorContext,
  UpdatePackageInput,
} from '@/data/types'

// 设施档案的受控更新全部在这里判断，页面组件不做业务规则。
// 规则：
// 1. 归档后只有档案管理员能提交更新；施工单位只能查看与补充附件。
// 2. 跨区域人员不能改动其他区域的档案。
// 3. 更新包必须同时包含设计图纸、竣工信息、承建企业变更，审核通过后才替换当前版本。
// 4. 同一档案同一时间只允许一个更新包进入审核（多人同时提交只放行一个）。
// 5. 已作废档案不能再被更新，也不能被缺陷记录引用。
// 6. 提交失败只返回缺失材料等原因，不改变当前归档状态。

const MODULE_KEY = 'facility_archive'
const MATERIAL_LABELS: { key: keyof UpdatePackageInput; label: string }[] = [
  { key: '设计图纸', label: '设计图纸' },
  { key: '竣工信息', label: '竣工信息' },
  { key: '承建企业变更', label: '承建企业变更' },
]

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** 读路径的兼容处理：补齐版本/更新包/附件数组；旧数据里的「待更新」归并为「已归档」。 */
export function normalizeFacilityRow(row: EntryRow): FacilityArchiveRow {
  const versions = asArray<ArchiveVersion>(row.versions)
  let versionsReady = versions
  const mappedStatus = row.status === '待更新' ? '已归档' : row.status
  // 旧的已归档档案没有版本快照，用当前字段补一个 v1，保证历史版本始终可追溯。
  if (versionsReady.length === 0 && mappedStatus !== '待归档') {
    versionsReady = [
      {
        version: 'v1',
        设计图纸: String(row.设计图纸 ?? ''),
        竣工信息: `竣工日期 ${String(row.竣工日期 ?? '不详')}`,
        承建企业: String(row.承建企业 ?? ''),
        变更说明: '首次归档（历史数据补录）',
        提交人: '档案管理员',
        提交时间: String(row.竣工日期 ?? ''),
        生效时间: String(row.竣工日期 ?? ''),
      },
    ]
  }
  return {
    ...row,
    status: mappedStatus,
    versions: versionsReady,
    packages: asArray<ArchivePackage>(row.packages),
    attachments: asArray<ArchiveAttachment>(row.attachments),
  }
}

export function listArchiveRows(): FacilityArchiveRow[] {
  return listRows(MODULE_KEY).map(normalizeFacilityRow)
}

export function currentVersion(row: FacilityArchiveRow): ArchiveVersion | null {
  return row.versions.length ? row.versions[row.versions.length - 1] : null
}

export function reviewingPackage(row: FacilityArchiveRow): ArchivePackage | null {
  return row.packages.find((item) => item.status === '审核中') ?? null
}

function sameRegion(row: FacilityArchiveRow, operator: OperatorContext): boolean {
  return String(row.所属区域 ?? '') === operator.region
}

function loadForMutate(id: number): { rows: EntryRow[]; index: number; row: FacilityArchiveRow } | null {
  const store = reloadCache()
  const rows = store[MODULE_KEY] ?? []
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return null
  }
  return { rows, index, row: normalizeFacilityRow(rows[index]) }
}

function persist(rows: EntryRow[], index: number, row: FacilityArchiveRow): void {
  const next = [...rows]
  next[index] = row
  saveRows(MODULE_KEY, next)
}

export type ArchivePermissions = {
  isArchivist: boolean
  sameRegion: boolean
  canArchive: boolean
  canSubmitUpdate: boolean
  canReview: boolean
  canSupplement: boolean
  canVoid: boolean
}

/** 页面按这份权限渲染按钮；真正的拦截仍在下面的动作函数里再做一遍。 */
export function archivePermissions(row: FacilityArchiveRow, operator: OperatorContext): ArchivePermissions {
  const archivist = operator.role === '档案管理员'
  const inRegion = sameRegion(row, operator)
  const archived = row.status === '已归档'
  const locked = reviewingPackage(row) !== null
  return {
    isArchivist: archivist,
    sameRegion: inRegion,
    canArchive: row.status === '待归档' && archivist && inRegion,
    canSubmitUpdate: archived && archivist && inRegion && !locked,
    canReview: archived && archivist && inRegion && locked,
    // 施工单位只能补充附件，但同样不得跨区域改动；同区域档案管理员也可补材料。
    canSupplement: archived && inRegion,
    canVoid: archived && archivist && inRegion && !locked,
  }
}

/** 待归档 -> 已归档：同区域档案管理员操作，同时固化 v1 版本包。 */
export function submitArchive(id: number, operator: OperatorContext & { operatorName: string }): ActionResult {
  const loaded = loadForMutate(id)
  if (!loaded) {
    return { ok: false, message: '没有找到这份设施档案' }
  }
  const { rows, index, row } = loaded
  if (row.status !== '待归档') {
    return { ok: false, message: `档案当前为「${row.status}」，无需提交归档` }
  }
  if (operator.role !== '档案管理员') {
    return { ok: false, message: '只有档案管理员可以提交归档，施工单位仅可查看与补充附件' }
  }
  if (!sameRegion(row, operator)) {
    return { ok: false, message: `跨区域不能改动其他区域的档案（档案属${String(row.所属区域)}，你负责${operator.region}）` }
  }
  const time = nowText()
  const v1: ArchiveVersion = {
    version: 'v1',
    设计图纸: String(row.设计图纸 ?? ''),
    竣工信息: `竣工日期 ${String(row.竣工日期 ?? '不详')}`,
    承建企业: String(row.承建企业 ?? ''),
    变更说明: '首次归档',
    提交人: operator.operatorName,
    提交时间: time,
    生效时间: time,
  }
  const updated: FacilityArchiveRow = {
    ...row,
    status: '已归档',
    pending: false,
    abnormal: false,
    档案状态: '当前版本 v1',
    versions: [v1],
  }
  persist(rows, index, updated)
  return { ok: true, message: `档案已归档，当前版本 v1` }
}

/** 提交受控更新包：任何一条不满足都原样返回失败，当前归档状态不变。 */
export function submitArchiveUpdate(
  id: number,
  input: UpdatePackageInput,
  operator: OperatorContext & { operatorName: string },
): ActionResult {
  const loaded = loadForMutate(id)
  if (!loaded) {
    return { ok: false, message: '没有找到这份设施档案' }
  }
  const { rows, index, row } = loaded
  if (row.status === '已作废') {
    return { ok: false, message: '档案已作废，不能再提交更新' }
  }
  if (row.status !== '已归档') {
    return { ok: false, message: `档案尚未归档（当前「${row.status}」），归档后才能提交更新` }
  }
  if (operator.role !== '档案管理员') {
    return { ok: false, message: '归档后只有档案管理员能提交更新，施工单位只能查看与补充附件' }
  }
  if (!sameRegion(row, operator)) {
    return { ok: false, message: `跨区域不能改动其他区域的档案（档案属${String(row.所属区域)}，你负责${operator.region}）` }
  }
  if (reviewingPackage(row)) {
    return { ok: false, message: '该档案已有更新包在审核中，同一时间只允许一个版本进入审核，请等当前审核结束' }
  }
  const missing = MATERIAL_LABELS.filter(({ key }) => String(input[key] ?? '').trim() === '').map(
    ({ label }) => label,
  )
  if (missing.length > 0) {
    return { ok: false, message: `更新包材料不完整，缺失：${missing.join('、')}；当前归档状态保持不变` }
  }

  const nextId = row.packages.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const pkg: ArchivePackage = {
    id: nextId,
    archiveId: id,
    status: '审核中',
    设计图纸: input.设计图纸.trim(),
    竣工信息: input.竣工信息.trim(),
    承建企业变更: input.承建企业变更.trim(),
    备注: (input.备注 ?? '').trim(),
    提交人: operator.operatorName,
    提交人角色: operator.role,
    提交人区域: operator.region,
    提交时间: nowText(),
    审核人: '',
    审核时间: '',
    审核意见: '',
  }
  const updated: FacilityArchiveRow = {
    ...row,
    pending: true,
    档案状态: '更新包审核中（当前版本仍生效）',
    packages: [...row.packages, pkg],
  }
  persist(rows, index, updated)
  return {
    ok: true,
    message: `更新包已提交并进入审核（含设计图纸、竣工信息、承建企业变更），审核通过前仍使用当前版本`,
  }
}

/** 审核更新包：通过才生成新版本并替换当前版本；驳回需要填写意见，当前版本继续生效。 */
export function reviewArchivePackage(
  archiveId: number,
  packageId: number,
  approved: boolean,
  opinion: string,
  operator: OperatorContext & { operatorName: string },
): ActionResult {
  const loaded = loadForMutate(archiveId)
  if (!loaded) {
    return { ok: false, message: '没有找到这份设施档案' }
  }
  const { rows, index, row } = loaded
  if (operator.role !== '档案管理员') {
    return { ok: false, message: '只有档案管理员可以审核更新包' }
  }
  if (!sameRegion(row, operator)) {
    return { ok: false, message: `跨区域不能审核其他区域的档案（档案属${String(row.所属区域)}，你负责${operator.region}）` }
  }
  const pkgIndex = row.packages.findIndex((item) => Number(item.id) === Number(packageId))
  if (pkgIndex < 0) {
    return { ok: false, message: '没有找到这个更新包' }
  }
  if (row.packages[pkgIndex].status !== '审核中') {
    return { ok: false, message: `该更新包已${row.packages[pkgIndex].status}，不能重复审核` }
  }

  const reviewed: ArchivePackage = {
    ...row.packages[pkgIndex],
    status: approved ? '已通过' : '已驳回',
    审核人: operator.operatorName,
    审核时间: nowText(),
    审核意见: opinion.trim(),
  }
  const packages = [...row.packages]
  packages[pkgIndex] = reviewed

  if (!approved) {
    if (opinion.trim() === '') {
      return { ok: false, message: '驳回更新包必须填写审核意见，说明缺失或不合规的材料' }
    }
    const version = currentVersion(row)?.version ?? 'v1'
    const updated: FacilityArchiveRow = {
      ...row,
      pending: false,
      档案状态: `当前版本 ${version}（更新已驳回）`,
      packages,
    }
    persist(rows, index, updated)
    return { ok: true, message: `更新包已驳回，当前版本 ${version} 继续生效，归档状态未改变` }
  }

  const last = currentVersion(row)
  const nextNo = (last ? Number(String(last.version).replace(/^v/i, '')) || 0 : 0) + 1
  const nextVersionText = `v${nextNo}`
  const enterpriseChanged = !/^无变更/.test(reviewed.承建企业变更.trim())
  const nextEnterprise = enterpriseChanged ? reviewed.承建企业变更.trim() : String(last?.承建企业 ?? row.承建企业 ?? '')
  const newVersion: ArchiveVersion = {
    version: nextVersionText,
    设计图纸: reviewed.设计图纸,
    竣工信息: reviewed.竣工信息,
    承建企业: nextEnterprise,
    变更说明: enterpriseChanged ? `承建企业变更：${reviewed.承建企业变更}` : reviewed.备注 || '更新包审核通过',
    提交人: reviewed.提交人,
    提交时间: reviewed.提交时间,
    生效时间: reviewed.审核时间,
  }
  const updated: FacilityArchiveRow = {
    ...row,
    pending: false,
    设计图纸: newVersion.设计图纸,
    承建企业: nextEnterprise,
    档案状态: `当前版本 ${nextVersionText}`,
    versions: [...row.versions, newVersion],
    packages,
  }
  persist(rows, index, updated)
  return { ok: true, message: `更新包审核通过，已替换为 ${nextVersionText}；历史版本共 ${updated.versions.length} 个，均可追溯` }
}

/** 施工单位（或同区域管理员）补充附件：只追加材料，不碰档案内容与版本。 */
export function supplementArchiveAttachment(
  id: number,
  fileName: string,
  operator: OperatorContext & { operatorName: string },
): ActionResult {
  const loaded = loadForMutate(id)
  if (!loaded) {
    return { ok: false, message: '没有找到这份设施档案' }
  }
  const { rows, index, row } = loaded
  if (row.status === '已作废') {
    return { ok: false, message: '档案已作废，不能再补充附件' }
  }
  if (row.status !== '已归档') {
    return { ok: false, message: '档案归档后才能补充附件' }
  }
  if (!sameRegion(row, operator)) {
    return { ok: false, message: `跨区域不能改动其他区域的档案（档案属${String(row.所属区域)}，你负责${operator.region}）` }
  }
  if (fileName.trim() === '') {
    return { ok: false, message: '请填写要补充的附件名称' }
  }
  const attachment: ArchiveAttachment = {
    name: fileName.trim(),
    上传人: operator.operatorName,
    上传人角色: operator.role,
    上传时间: nowText(),
    version: currentVersion(row)?.version ?? 'v1',
  }
  const updated: FacilityArchiveRow = { ...row, attachments: [...row.attachments, attachment] }
  persist(rows, index, updated)
  return { ok: true, message: `附件「${attachment.name}」已补充到 ${attachment.version}，档案内容未改动` }
}

/** 作废档案：被缺陷记录引用时禁止作废，保证作废后不再被引用。 */
export function voidArchive(
  id: number,
  operator: OperatorContext,
  referencedByDefects: string[],
): ActionResult {
  const loaded = loadForMutate(id)
  if (!loaded) {
    return { ok: false, message: '没有找到这份设施档案' }
  }
  const { rows, index, row } = loaded
  if (row.status === '已作废') {
    return { ok: false, message: '档案已经是作废状态' }
  }
  if (operator.role !== '档案管理员') {
    return { ok: false, message: '只有档案管理员可以作废档案' }
  }
  if (!sameRegion(row, operator)) {
    return { ok: false, message: `跨区域不能改动其他区域的档案（档案属${String(row.所属区域)}，你负责${operator.region}）` }
  }
  if (reviewingPackage(row)) {
    return { ok: false, message: '该档案还有更新包在审核中，请先完成审核再作废' }
  }
  if (referencedByDefects.length > 0) {
    return {
      ok: false,
      message: `该档案正被缺陷记录 ${referencedByDefects.join('、')} 引用，作废档案不能再被缺陷记录引用，请先解除引用`,
    }
  }
  const updated: FacilityArchiveRow = {
    ...row,
    status: '已作废',
    pending: false,
    abnormal: true,
    档案状态: '已作废',
  }
  persist(rows, index, updated)
  return { ok: true, message: '档案已作废，此后不能再更新、补充附件或被缺陷记录引用；历史版本仍可追溯' }
}
