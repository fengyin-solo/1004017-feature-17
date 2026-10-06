/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryValue = string | number | boolean | object

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
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

/** 操作者身份：角色决定能不能动，负责区域决定能动哪一条。 */
export type OperatorRole = '档案管理员' | '施工单位'

export type OperatorContext = {
  role: OperatorRole
  region: string
}

/** 更新包携带的三类受控材料。 */
export type UpdatePackageInput = {
  设计图纸: string
  竣工信息: string
  承建企业变更: string
  备注?: string
}

/** 更新包审核状态：提交即进入「审核中」，审核通过前不替换当前版本。 */
export type ArchivePackageStatus = '审核中' | '已通过' | '已驳回'

/** 版本包：每次审核通过生成一个新版本，历史版本始终保留。 */
export type ArchiveVersion = {
  version: string
  设计图纸: string
  竣工信息: string
  承建企业: string
  变更说明: string
  提交人: string
  提交时间: string
  生效时间: string
}

/** 更新包：管理员提交的受控更新，含材料与审核结论。 */
export type ArchivePackage = {
  id: number
  archiveId: number
  status: ArchivePackageStatus
  设计图纸: string
  竣工信息: string
  承建企业变更: string
  备注: string
  提交人: string
  提交人角色: OperatorRole
  提交人区域: string
  提交时间: string
  审核人: string
  审核时间: string
  审核意见: string
}

/** 补充附件：施工单位只能往已归档档案上追加，不改档案内容。 */
export type ArchiveAttachment = {
  name: string
  上传人: string
  上传人角色: OperatorRole
  上传时间: string
  version: string
}

/** 设施档案行：在通用行基础上挂版本、更新包和附件。 */
export type FacilityArchiveRow = EntryRow & {
  versions: ArchiveVersion[]
  packages: ArchivePackage[]
  attachments: ArchiveAttachment[]
}
