import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, reloadCache, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

import {
  currentVersion,
  listArchiveRows,
  normalizeFacilityRow,
  reviewingPackage,
  submitArchive,
  submitArchiveUpdate,
  supplementArchiveAttachment,
  voidArchive,
  reviewArchivePackage,
} from './facility-archive'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const FACILITY_KEY = 'facility_archive'
const DEFECT_KEY = 'defect'

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
  // 设施档案走受控更新流程，禁止用通用流转直接改状态。
  if (key === FACILITY_KEY) {
    return {
      ok: false,
      message: '设施档案请使用提交归档、提交更新包、审核、补充附件等受控操作',
    }
  }
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

// ---- 设施档案：版本包与受控更新（页面统一从本服务调用，规则在 facility-archive.ts） ----

export {
  currentVersion,
  listArchiveRows,
  normalizeFacilityRow,
  reviewingPackage,
  submitArchive,
  submitArchiveUpdate,
  supplementArchiveAttachment,
  reviewArchivePackage,
}
export { archivePermissions } from './facility-archive'
export type { ArchivePermissions } from './facility-archive'

function defectsReferencingArchive(archiveCode: string): string[] {
  return listRows(DEFECT_KEY)
    .filter((row) => String(row.关联档案 ?? '') === archiveCode)
    .map((row) => String(row.缺陷编号 ?? row.id))
}

export function voidFacilityArchive(
  id: number,
  operator: { role: '档案管理员' | '施工单位'; region: string },
): ActionResult {
  const row = listArchiveRows().find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: '没有找到这份设施档案' }
  }
  const referenced = defectsReferencingArchive(String(row.档案编号 ?? ''))
  return voidArchive(id, operator, referenced)
}

/** 缺陷记录可选的关联档案：已作废档案不能再被引用。 */
export function referenceableArchives(): { id: number; code: string; name: string; region: string }[] {
  return listArchiveRows()
    .filter((row) => row.status !== '已作废')
    .map((row) => ({
      id: Number(row.id),
      code: String(row.档案编号 ?? ''),
      name: String(row.设施名称 ?? ''),
      region: String(row.所属区域 ?? ''),
    }))
}

/** 缺陷记录关联设施档案；作废档案一律拒绝，且不改缺陷自身状态。 */
export function linkDefectToArchive(defectId: number, archiveCode: string): ActionResult {
  const rows = reloadCache()[DEFECT_KEY] ?? []
  const index = rows.findIndex((row) => Number(row.id) === defectId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条缺陷记录' }
  }
  const code = archiveCode.trim()
  if (code === '') {
    const updated: EntryRow = { ...rows[index], 关联档案: '' }
    const next = [...rows]
    next[index] = updated
    saveRows(DEFECT_KEY, next)
    return { ok: true, message: '已解除缺陷记录与设施档案的关联' }
  }
  const archive = listArchiveRows().find((row) => String(row.档案编号 ?? '') === code)
  if (!archive) {
    return { ok: false, message: `没有找到档案编号为 ${code} 的设施档案，关联失败，缺陷记录未改动` }
  }
  if (archive.status === '已作废') {
    return { ok: false, message: `档案 ${code} 已作废，作废档案不能再被缺陷记录引用，关联失败，缺陷记录未改动` }
  }
  const updated: EntryRow = { ...rows[index], 关联档案: code }
  const next = [...rows]
  next[index] = updated
  saveRows(DEFECT_KEY, next)
  return { ok: true, message: `缺陷记录已关联档案 ${code}（${String(archive.设施名称 ?? '')}）` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: EntryRow[string]): string {
  if (Array.isArray(value)) {
    return `共${value.length}项`
  }
  return String(value ?? '')
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  // 设施档案导出走版本兼容后的行，避免旧缓存里的「待更新」状态漏进清单。
  const sourceRows = key === FACILITY_KEY ? listArchiveRows() : listRows(key)
  for (const row of sourceRows) {
    lines.push([row.id, ...meta.fields.map((field) => csvCell(row[field])), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
    let entries = rows[meta.key] ?? []
    if (meta.key === FACILITY_KEY) {
      // 设施档案的待处理 = 有更新包在审核中，而不是旧的「待更新」状态。
      entries = entries.map((row) => ({
        ...row,
        pending: reviewingPackage(normalizeFacilityRow(row)) !== null,
      }))
    }
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
