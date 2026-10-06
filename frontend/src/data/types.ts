/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ---- 设施档案版本包与受控更新 ----

/** 档案相关角色：档案管理员提交更新，施工单位只能查看与补充附件，档案审核员负责审核。 */
export type ArchiveRole = '档案管理员' | '施工单位' | '档案审核员'

/** 当前操作人：所有改动类动作都要带这个角色 + 区域上下文过权限闸。 */
export type Operator = {
  name: string
  role: ArchiveRole
  region: string
}

/** 档案版本快照：每次归档 / 审核通过各落一条，历史版本永不删除。 */
export type ArchiveVersion = {
  id: number
  archiveId: number
  version: number
  设计图纸: string
  竣工信息: string
  承建企业: string
  版本说明: string
  /** 版本来源：初始归档 或 更新包PKG-xxxx */
  source: string
  packageId?: number
  effectiveAt: string
  createdBy: string
}

/** 更新包：设计图纸、竣工信息、承建企业变更三样材料齐全才能提交，审核通过才替换当前版本。 */
export type ArchivePackage = {
  id: number
  archiveId: number
  packageNo: string
  /** 基于哪个版本发起的更新 */
  baseVersion: number
  status: '审核中' | '已通过' | '已驳回'
  设计图纸: string
  竣工信息: string
  承建企业: string
  变更说明: string
  submittedBy: string
  submittedAt: string
  reviewedBy?: string
  reviewedAt?: string
  reviewComment?: string
}

/** 施工单位等补充的附件：挂在档案上，不改变版本内容。 */
export type ArchiveAttachment = {
  id: number
  archiveId: number
  name: string
  category: string
  uploadedBy: string
  uploadedAt: string
}

export type ArchiveExtData = {
  versions: ArchiveVersion[]
  packages: ArchivePackage[]
  attachments: ArchiveAttachment[]
}

export type ArchiveDetail = {
  row: EntryRow | null
  versions: ArchiveVersion[]
  packages: ArchivePackage[]
  attachments: ArchiveAttachment[]
  currentVersion: ArchiveVersion | null
}
