import { allArchiveExt, saveArchiveExt } from '@/data/archive-store'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  ArchiveDetail,
  ArchivePackage,
  ArchiveVersion,
  EntryRow,
  Operator,
} from '@/data/types'

// 设施档案的受控更新全部走这里：权限、区域、材料校验、单审核并发闸、审核替换版本。
// 页面只负责渲染和转发操作人上下文，不做业务判断。
const MODULE_KEY = 'facility_archive'

const ROLE_ADMIN = '档案管理员'
const ROLE_CONSTRUCTION = '施工单位'
const ROLE_REVIEWER = '档案审核员'

export type UpdatePackageInput = {
  设计图纸: string
  竣工信息: string
  承建企业: string
  变更说明: string
}

export type AttachmentInput = {
  name: string
  category: string
}

export type PackageResult = ActionResult & { missing?: string[] }

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function nextVersionNo(archiveId: number): number {
  return (
    allArchiveExt().versions
      .filter((v) => v.archiveId === archiveId)
      .reduce((max, v) => Math.max(max, v.version), 0) + 1
  )
}

function findArchive(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | null {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return null
  }
  return { rows, index, row: rows[index] }
}

// 改动类动作的统一闸门：先卡角色，再卡区域。跨区域人员一律不能改动其他区域的档案。
function checkModify(row: EntryRow, op: Operator, roles: string[], action: string): string | null {
  if (!roles.includes(op.role)) {
    if (op.role === ROLE_CONSTRUCTION && roles.includes(ROLE_ADMIN)) {
      return `归档后只有档案管理员能${action}，施工单位只能查看与补充附件`
    }
    return `当前角色「${op.role}」无权${action}，仅限${roles.join('、')}操作`
  }
  if (String(row['所属区域']) !== op.region) {
    return `跨区域人员不能改动其他区域的档案：档案属于「${String(row['所属区域'])}」，当前区域「${op.region}」`
  }
  return null
}

function pendingPackageOf(archiveId: number): ArchivePackage | undefined {
  return allArchiveExt().packages.find((p) => p.archiveId === archiveId && p.status === '审核中')
}

export function getArchiveDetail(id: number): ArchiveDetail {
  const row = listRows(MODULE_KEY).find((item) => Number(item.id) === id) ?? null
  const ext = allArchiveExt()
  const versions = ext.versions
    .filter((v) => v.archiveId === id)
    .sort((a, b) => b.version - a.version)
  const packages = ext.packages
    .filter((p) => p.archiveId === id)
    .sort((a, b) => b.id - a.id)
  const attachments = ext.attachments
    .filter((a) => a.archiveId === id)
    .sort((a, b) => b.id - a.id)
  return { row, versions, packages, attachments, currentVersion: versions[0] ?? null }
}

/** 每份档案的当前版本号（列表页展示用）：取该档案最大版本号。 */
export function currentVersionMap(): Map<number, number> {
  const map = new Map<number, number>()
  for (const v of allArchiveExt().versions) {
    map.set(v.archiveId, Math.max(map.get(v.archiveId) ?? 0, v.version))
  }
  return map
}

/** 提交归档：待归档 -> 已归档，同时落下初始版本 V1。 */
export function submitArchive(id: number, op: Operator): ActionResult {
  const found = findArchive(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的设施档案` }
  }
  const { rows, index, row } = found
  const deny = checkModify(row, op, [ROLE_ADMIN], '提交归档')
  if (deny) {
    return { ok: false, message: deny }
  }
  if (row.status !== '待归档') {
    return { ok: false, message: `只有「待归档」的档案才能提交归档，当前状态「${String(row.status)}」` }
  }
  const ext = allArchiveExt()
  const version: ArchiveVersion = {
    id: nextId(ext.versions),
    archiveId: id,
    version: nextVersionNo(id),
    设计图纸: String(row['设计图纸'] ?? ''),
    竣工信息: String(row['竣工日期'] ?? ''),
    承建企业: String(row['承建企业'] ?? ''),
    版本说明: '初始归档',
    source: '初始归档',
    effectiveAt: now(),
    createdBy: op.name,
  }
  saveArchiveExt({ ...ext, versions: [...ext.versions, version] })
  const next = [...rows]
  next[index] = { ...row, status: '已归档', pending: false, abnormal: false }
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `档案已归档，生成初始版本 V${version.version}` }
}

/**
 * 提交更新包：已归档 -> 待更新。
 * 设计图纸、竣工信息、承建企业变更三样材料缺一不可，缺材料只报错、不改变当前归档状态；
 * 同一档案已有审核中的更新包时直接拒绝，多人同时提交也只允许一个版本进入审核。
 */
export function submitUpdatePackage(id: number, input: UpdatePackageInput, op: Operator): PackageResult {
  const found = findArchive(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的设施档案` }
  }
  const { rows, index, row } = found
  if (row.status === '已作废') {
    return { ok: false, message: '作废档案不能再被更新' }
  }
  const deny = checkModify(row, op, [ROLE_ADMIN], '提交更新')
  if (deny) {
    return { ok: false, message: deny }
  }
  const missing: string[] = []
  if (!input.设计图纸.trim()) missing.push('设计图纸')
  if (!input.竣工信息.trim()) missing.push('竣工信息')
  if (!input.承建企业.trim()) missing.push('承建企业变更')
  if (missing.length > 0) {
    return { ok: false, message: `更新包缺少材料：${missing.join('、')}，已保留当前归档状态`, missing }
  }
  const ext = allArchiveExt()
  const pending = pendingPackageOf(id)
  if (pending) {
    return {
      ok: false,
      message: `更新包 ${pending.packageNo} 正在审核中，多人同时提交时只允许一个版本进入审核`,
    }
  }
  if (row.status !== '已归档') {
    return { ok: false, message: `只有「已归档」的档案才能提交更新包，当前状态「${String(row.status)}」` }
  }
  const pkgId = nextId(ext.packages)
  const pkg: ArchivePackage = {
    id: pkgId,
    archiveId: id,
    packageNo: `PKG-${String(pkgId).padStart(4, '0')}`,
    baseVersion: nextVersionNo(id) - 1,
    status: '审核中',
    设计图纸: input.设计图纸.trim(),
    竣工信息: input.竣工信息.trim(),
    承建企业: input.承建企业.trim(),
    变更说明: input.变更说明.trim(),
    submittedBy: op.name,
    submittedAt: now(),
  }
  saveArchiveExt({ ...ext, packages: [...ext.packages, pkg] })
  const next = [...rows]
  next[index] = { ...row, status: '待更新', pending: true }
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `更新包 ${pkg.packageNo} 已提交，审核通过后才替换当前版本` }
}

/** 审核更新包：通过则更新包内容替换当前版本并落新版本快照，驳回则回到已归档、版本不变。 */
export function reviewPackage(
  archiveId: number,
  packageId: number,
  approve: boolean,
  comment: string,
  op: Operator,
): ActionResult {
  const found = findArchive(archiveId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${archiveId} 的设施档案` }
  }
  const { rows, index, row } = found
  const deny = checkModify(row, op, [ROLE_REVIEWER], '审核更新包')
  if (deny) {
    return { ok: false, message: deny }
  }
  const ext = allArchiveExt()
  const pkg = ext.packages.find((p) => p.id === packageId && p.archiveId === archiveId)
  if (!pkg) {
    return { ok: false, message: '没有找到对应的更新包' }
  }
  if (pkg.status !== '审核中') {
    return { ok: false, message: `更新包 ${pkg.packageNo} 已完成审核（${pkg.status}），不能重复审核` }
  }
  if (!approve && !comment.trim()) {
    return { ok: false, message: '驳回更新包必须填写审核意见，说明缺失材料或问题' }
  }
  const reviewed: ArchivePackage = {
    ...pkg,
    status: approve ? '已通过' : '已驳回',
    reviewedBy: op.name,
    reviewedAt: now(),
    reviewComment: comment.trim(),
  }
  const packages = ext.packages.map((p) => (p.id === pkg.id ? reviewed : p))
  let versions = ext.versions
  const next = [...rows]
  if (approve) {
    const version: ArchiveVersion = {
      id: nextId(ext.versions),
      archiveId,
      version: nextVersionNo(archiveId),
      设计图纸: pkg.设计图纸,
      竣工信息: pkg.竣工信息,
      承建企业: pkg.承建企业,
      版本说明: pkg.变更说明 || `更新包 ${pkg.packageNo} 审核通过`,
      source: `更新包${pkg.packageNo}`,
      packageId: pkg.id,
      effectiveAt: now(),
      createdBy: op.name,
    }
    versions = [...ext.versions, version]
    next[index] = {
      ...row,
      设计图纸: pkg.设计图纸,
      竣工日期: pkg.竣工信息,
      承建企业: pkg.承建企业,
      status: '已归档',
      pending: false,
    }
    saveArchiveExt({ ...ext, packages, versions })
    saveRows(MODULE_KEY, next)
    return { ok: true, message: `更新包 ${pkg.packageNo} 审核通过，当前版本已替换为 V${version.version}，历史版本可追溯` }
  }
  saveArchiveExt({ ...ext, packages, versions })
  next[index] = { ...row, status: '已归档', pending: false }
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `更新包 ${pkg.packageNo} 已驳回，当前归档版本不变` }
}

/** 补充附件：施工单位与档案管理员都可以，但只挂附件、不动版本内容；作废档案一律拒绝。 */
export function addAttachment(id: number, input: AttachmentInput, op: Operator): ActionResult {
  const found = findArchive(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的设施档案` }
  }
  const { row } = found
  if (row.status === '已作废') {
    return { ok: false, message: '作废档案不能再补充附件' }
  }
  const deny = checkModify(row, op, [ROLE_ADMIN, ROLE_CONSTRUCTION], '补充附件')
  if (deny) {
    return { ok: false, message: deny }
  }
  if (!input.name.trim()) {
    return { ok: false, message: '附件名称不能为空' }
  }
  const ext = allArchiveExt()
  const attachment = {
    id: nextId(ext.attachments),
    archiveId: id,
    name: input.name.trim(),
    category: input.category.trim() || '补充材料',
    uploadedBy: `${op.name}（${op.role}）`,
    uploadedAt: now(),
  }
  saveArchiveExt({ ...ext, attachments: [...ext.attachments, attachment] })
  return { ok: true, message: `附件「${attachment.name}」已补充到档案 ${String(row['档案编号'])}` }
}

/** 作废档案：作废后不能再更新、不能补充附件，也不能被缺陷记录引用；历史版本保留可追溯。 */
export function voidArchive(id: number, op: Operator): ActionResult {
  const found = findArchive(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的设施档案` }
  }
  const { rows, index, row } = found
  const deny = checkModify(row, op, [ROLE_ADMIN], '作废档案')
  if (deny) {
    return { ok: false, message: deny }
  }
  if (row.status === '已作废') {
    return { ok: false, message: '档案已作废，不用重复操作' }
  }
  const pending = pendingPackageOf(id)
  if (pending) {
    return { ok: false, message: `更新包 ${pending.packageNo} 正在审核中，请先完成审核再作废` }
  }
  const next = [...rows]
  next[index] = { ...row, status: '已作废', pending: false, abnormal: true }
  saveRows(MODULE_KEY, next)
  return { ok: true, message: '档案已作废：不能再更新，也不能被缺陷记录引用，历史版本保留可追溯' }
}
