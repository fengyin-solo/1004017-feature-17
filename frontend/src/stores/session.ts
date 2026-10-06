import { defineStore } from 'pinia'

import type { OperatorRole } from '@/data/types'

// 演示用身份：设施档案的受控更新要按角色和负责区域放行，所以会话里同时保存这两项。
export const OPERATOR_ROLES: OperatorRole[] = ['档案管理员', '施工单位']
export const OPERATOR_REGIONS = ['城东片区', '城西片区', '城南片区', '城北片区']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '档案管理员' as OperatorRole,
    region: '城东片区',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isArchivist: (state) => state.role === '档案管理员',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: OperatorRole) {
      this.role = role
      this.operator = role === '档案管理员' ? '值班管理员' : '施工单位经办人'
    },
    setRegion(region: string) {
      this.region = region
    },
  },
})
