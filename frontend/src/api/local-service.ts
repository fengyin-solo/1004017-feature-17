import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export type DefectInput = {
  所属管线: string
  缺陷类型: string
  发现位置: string
  严重等级: string
  关联档案: string
  缺陷描述: string
}

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 登记缺陷记录：关联设施档案时先校验档案状态，作废档案不能被缺陷记录引用。
export function registerDefect(input: DefectInput): ActionResult {
  const required: [string, string][] = [
    ['所属管线', input.所属管线],
    ['缺陷类型', input.缺陷类型],
    ['发现位置', input.发现位置],
  ]
  const missing = required.filter(([, value]) => !value.trim()).map(([field]) => field)
  if (missing.length > 0) {
    return { ok: false, message: `缺陷记录缺少必填项：${missing.join('、')}` }
  }
  const archiveCode = input.关联档案.trim()
  if (archiveCode) {
    const archive = listRows('facility_archive').find(
      (row) => String(row['档案编号']) === archiveCode,
    )
    if (!archive) {
      return { ok: false, message: `关联的设施档案 ${archiveCode} 不存在` }
    }
    if (String(archive.status) === '已作废') {
      return { ok: false, message: `设施档案 ${archiveCode} 已作废，作废档案不能被缺陷记录引用` }
    }
  }
  const rows = listRows('defect')
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const code = `DEFE-${String(id).padStart(4, '0')}`
  const row: EntryRow = {
    id,
    status: '待确认',
    pending: true,
    abnormal: false,
    缺陷编号: code,
    所属管线: input.所属管线.trim(),
    缺陷类型: input.缺陷类型.trim(),
    发现位置: input.发现位置.trim(),
    严重等级: input.严重等级.trim() || '一般',
    发现日期: today(),
    缺陷描述: input.缺陷描述.trim(),
    记录状态: '待确认',
    ...(archiveCode ? { 关联档案: archiveCode } : {}),
  }
  saveRows('defect', [...rows, row])
  return { ok: true, message: `缺陷记录 ${code} 已登记，当前状态「待确认」` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
