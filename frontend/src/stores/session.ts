import { defineStore } from 'pinia'

import type { ArchiveRole } from '@/data/types'

// 档案相关角色与区域：头部可切换，用来演示受控更新的权限与跨区域限制。
export const ARCHIVE_ROLES: ArchiveRole[] = ['档案管理员', '施工单位', '档案审核员']
export const ARCHIVE_REGIONS = ['城东区', '城西区', '城北区', '城南区']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '档案管理员' as ArchiveRole,
    region: '城东区',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: ArchiveRole) {
      this.role = role
    },
    setRegion(region: string) {
      this.region = region
    },
  },
})
