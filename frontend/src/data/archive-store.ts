import type { ArchiveExtData } from './types'

// 档案版本 / 更新包 / 附件单独存一份，和条目清单（local-store）分开，互不覆盖。
const STORAGE_KEY = 'underground-pipeline-inspection:archive-ext'

// 示例数据：已归档档案带初始版本，待更新档案带一个审核中的更新包，已作废档案保留完整历史。
const SEED: ArchiveExtData = {
  versions: [
    {
      id: 1,
      archiveId: 2,
      version: 1,
      设计图纸: '图纸-PS-2026-004',
      竣工信息: '2026-07-20',
      承建企业: '市政建设集团',
      版本说明: '初始归档',
      source: '初始归档',
      effectiveAt: '2026-07-25 10:00',
      createdBy: '值班管理员',
    },
    {
      id: 2,
      archiveId: 3,
      version: 1,
      设计图纸: '图纸-TS-2026-002',
      竣工信息: '2026-06-30',
      承建企业: '水务工程公司',
      版本说明: '初始归档',
      source: '初始归档',
      effectiveAt: '2026-07-02 09:30',
      createdBy: '值班管理员',
    },
    {
      id: 3,
      archiveId: 4,
      version: 1,
      设计图纸: '图纸-JW-2025-018',
      竣工信息: '2025-12-10',
      承建企业: '城建二公司',
      版本说明: '初始归档',
      source: '初始归档',
      effectiveAt: '2025-12-20 15:00',
      createdBy: '值班管理员',
    },
    {
      id: 4,
      archiveId: 4,
      version: 2,
      设计图纸: '图纸-JW-2025-018-B',
      竣工信息: '2025-12-10',
      承建企业: '城建二公司',
      版本说明: '补充截污管改线图纸',
      source: '更新包PKG-0001',
      packageId: 2,
      effectiveAt: '2026-01-15 11:00',
      createdBy: '档案审核员',
    },
  ],
  packages: [
    {
      id: 1,
      archiveId: 3,
      packageNo: 'PKG-0002',
      baseVersion: 1,
      status: '审核中',
      设计图纸: '图纸-TS-2026-002-A',
      竣工信息: '2026-06-30',
      承建企业: '水务工程公司（联合体）',
      变更说明: '补充调蓄池扩容竣工资料',
      submittedBy: '值班管理员',
      submittedAt: '2026-09-28 14:20',
    },
    {
      id: 2,
      archiveId: 4,
      packageNo: 'PKG-0001',
      baseVersion: 1,
      status: '已通过',
      设计图纸: '图纸-JW-2025-018-B',
      竣工信息: '2025-12-10',
      承建企业: '城建二公司',
      变更说明: '补充截污管改线图纸',
      submittedBy: '值班管理员',
      submittedAt: '2026-01-12 09:10',
      reviewedBy: '档案审核员',
      reviewedAt: '2026-01-15 11:00',
      reviewComment: '材料齐全，同意替换',
    },
  ],
  attachments: [
    {
      id: 1,
      archiveId: 2,
      name: '隐蔽工程验收影像.pdf',
      category: '验收影像',
      uploadedBy: '城建一公司（施工单位）',
      uploadedAt: '2026-07-26 16:40',
    },
    {
      id: 2,
      archiveId: 3,
      name: '扩容段压力试验报告.pdf',
      category: '试验报告',
      uploadedBy: '水务工程公司（施工单位）',
      uploadedAt: '2026-09-29 10:05',
    },
  ],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): ArchiveExtData {
  const fallback = clone(SEED)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ArchiveExtData>
    return {
      versions: parsed.versions ?? fallback.versions,
      packages: parsed.packages ?? fallback.packages,
      attachments: parsed.attachments ?? fallback.attachments,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: ArchiveExtData | null = null

export function allArchiveExt(): ArchiveExtData {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveArchiveExt(data: ArchiveExtData): void {
  cache = data
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

export function resetArchiveExt(): ArchiveExtData {
  const data = clone(SEED)
  saveArchiveExt(data)
  return data
}
