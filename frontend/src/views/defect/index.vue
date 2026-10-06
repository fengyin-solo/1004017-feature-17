<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷记录管理</h2>
        <p class="page-desc">维护缺陷记录，围绕缺陷编号、所属管线、缺陷类型、发现位置做登记、筛选与状态流转；缺陷可关联在役设施档案，已作废档案不能被引用。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '关联档案'">
              <span>{{ row[column] || '—' }}</span>
              <em v-if="row[column] && archiveState(String(row[column])) === '已作废'" class="warn-text">（档案已作废）</em>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openLink(row)">关联档案</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无缺陷记录数据，可先登记缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 关联设施档案 -->
    <div v-if="linkOpen" class="modal-mask" @click.self="linkOpen = false">
      <div class="modal">
        <h3>关联设施档案 · {{ linkTarget?.缺陷编号 }}</h3>
        <p class="modal-sub">只能选择未作废的档案；作废档案不能再被缺陷记录引用。关联操作不改变缺陷当前状态。</p>
        <label class="form-row">
          <span>设施档案</span>
          <select v-model="linkCode">
            <option value="">（不关联）</option>
            <option v-for="archive in archiveOptions" :key="archive.code" :value="archive.code">
              {{ archive.code }} · {{ archive.name }}（{{ archive.region }}）
            </option>
          </select>
        </label>
        <p v-if="linkTarget?.关联档案 && archiveState(String(linkTarget.关联档案)) === '已作废'" class="warn-text">
          当前关联的档案 {{ linkTarget.关联档案 }} 已作废，可改关联其他在役档案。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="linkOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitLink">保存关联</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  linkDefectToArchive,
  listArchiveRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('defect')
const columns = ['缺陷编号', '所属管线', '缺陷类型', '发现位置', '严重等级', '发现日期', '关联档案', '缺陷描述', '记录状态']
const actions = ['确认缺陷', '标记修复', '忽略缺陷']
const statuses = ['待确认', '已确认', '已修复', '已忽略']
const stats = ref([{ label: '待确认缺陷', value: 0 }, { label: '已修复缺陷', value: 0 }, { label: '严重缺陷', value: 0 }])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const linkOpen = ref(false)
const linkTarget = ref<EntryRow | null>(null)
const linkCode = ref('')
const archiveRows = ref(listArchiveRows())
const archiveOptions = computed(() =>
  archiveRows.value
    .filter((row) => row.status !== '已作废')
    .map((row) => ({
      code: String(row.档案编号 ?? ''),
      name: String(row.设施名称 ?? ''),
      region: String(row.所属区域 ?? ''),
    })),
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function archiveState(code: string | number): string {
  return archiveRows.value.find((row) => String(row.档案编号 ?? '') === String(code))?.status ?? ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '缺陷记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openLink(row: EntryRow) {
  linkTarget.value = row
  linkCode.value = String(row.关联档案 ?? '')
  linkOpen.value = true
}

function submitLink() {
  if (!linkTarget.value) return
  const result = linkDefectToArchive(Number(linkTarget.value.id), linkCode.value)
  errorMessage.value = result.ok ? '' : result.message
  if (result.ok) {
    linkOpen.value = false
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  archiveRows.value = listArchiveRows()
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: '待确认缺陷', value: rows.value.filter((row) => row.status === '待确认').length },
      { label: '已修复缺陷', value: rows.value.filter((row) => row.status === '已修复').length },
      { label: '严重缺陷', value: rows.value.filter((row) => String(row.严重等级 ?? '').includes('严重')).length },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷记录列表读取失败'
  }
}

onMounted(reload)
</script>
