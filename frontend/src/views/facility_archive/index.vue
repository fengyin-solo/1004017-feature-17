<template>
  <section class="page" data-module="facility_archive">
    <header class="page-head">
      <div>
        <h2>设施档案管理</h2>
        <p class="page-desc">设施档案实行版本包受控更新：归档后仅档案管理员可提交更新包，施工单位只能查看与补充附件，更新包审核通过后才替换当前版本，历史版本全程可追溯。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记设施档案</button>
        <button class="btn" type="button" @click="exportRows">导出设施档案清单</button>
      </div>
    </header>

    <p class="perm-hint">
      当前角色「{{ store.role }}」· 所在区域「{{ store.region }}」：
      <template v-if="store.role === '档案管理员'">可提交归档、提交更新包、补充附件与作废本区域档案，更新包须审核员审核后才生效。</template>
      <template v-else-if="store.role === '施工单位'">只能查看档案与补充附件，不能提交更新。</template>
      <template v-else>负责审核本区域档案的更新包，审核通过后更新包才替换当前版本。</template>
      跨区域人员不能改动其他区域的档案。
    </p>

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
          <th>当前版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ versionLabel(row) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button v-if="canSubmitArchive(row)" class="link" type="button" @click="runSubmitArchive(row)">提交归档</button>
            <button v-if="canSubmitPackage(row)" class="link" type="button" @click="openPackageForm(row)">提交更新包</button>
            <button v-if="canVoid(row)" class="link" type="button" @click="runVoid(row)">作废档案</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无设施档案数据，可先登记设施档案</td>
        </tr>
      </tbody>
    </table>

    <section v-if="detail && detail.row" class="detail-panel">
      <header class="detail-head">
        <h3>档案详情：{{ detail.row['档案编号'] }} · {{ detail.row['设施名称'] }}</h3>
        <button class="btn ghost" type="button" @click="closeDetail">收起详情</button>
      </header>
      <p class="detail-meta">
        所属区域 {{ detail.row['所属区域'] }} · 档案状态 {{ detail.row.status }} ·
        当前版本 {{ detail.currentVersion ? `V${detail.currentVersion.version}` : '暂无版本' }}
      </p>

      <div class="detail-grid">
        <section class="detail-block">
          <h4>当前版本内容</h4>
          <dl v-if="detail.currentVersion" class="version-current">
            <div><dt>设计图纸</dt><dd>{{ detail.currentVersion.设计图纸 }}</dd></div>
            <div><dt>竣工信息</dt><dd>{{ detail.currentVersion.竣工信息 }}</dd></div>
            <div><dt>承建企业</dt><dd>{{ detail.currentVersion.承建企业 }}</dd></div>
            <div><dt>版本来源</dt><dd>{{ detail.currentVersion.source }}</dd></div>
            <div><dt>生效时间</dt><dd>{{ detail.currentVersion.effectiveAt }}</dd></div>
          </dl>
          <p v-else class="empty-state">档案尚未归档，暂无版本内容</p>
        </section>

        <section class="detail-block">
          <h4>历史版本（{{ detail.versions.length }}）</h4>
          <table v-if="detail.versions.length" class="data-table">
            <thead>
              <tr><th>版本</th><th>来源</th><th>生效时间</th><th>操作人</th><th>版本说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="version in detail.versions" :key="version.id">
                <td>
                  V{{ version.version }}
                  <span v-if="detail.currentVersion && version.id === detail.currentVersion.id" class="badge">当前</span>
                </td>
                <td>{{ version.source }}</td>
                <td>{{ version.effectiveAt }}</td>
                <td>{{ version.createdBy }}</td>
                <td>{{ version.版本说明 }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty-state">暂无历史版本</p>
        </section>
      </div>

      <section class="detail-block">
        <h4>更新包（{{ detail.packages.length }}）</h4>
        <table v-if="detail.packages.length" class="data-table">
          <thead>
            <tr>
              <th>更新包编号</th><th>基于版本</th><th>更新材料</th><th>状态</th>
              <th>提交人</th><th>提交时间</th><th>审核人</th><th>审核意见</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pkg in detail.packages" :key="pkg.id">
              <td>{{ pkg.packageNo }}</td>
              <td>V{{ pkg.baseVersion }}</td>
              <td class="materials-cell">
                设计图纸：{{ pkg.设计图纸 }}<br />
                竣工信息：{{ pkg.竣工信息 }}<br />
                承建企业：{{ pkg.承建企业 }}
              </td>
              <td>{{ pkg.status }}</td>
              <td>{{ pkg.submittedBy }}</td>
              <td>{{ pkg.submittedAt }}</td>
              <td>{{ pkg.reviewedBy ?? '—' }}</td>
              <td>{{ pkg.reviewComment ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">暂无更新包</p>

        <div v-if="pendingPackage && canReview" class="review-bar">
          <input v-model="reviewComment" placeholder="审核意见（驳回时必填，说明缺失材料或问题）" />
          <button class="btn primary" type="button" @click="runReview(true)">审核通过</button>
          <button class="btn" type="button" @click="runReview(false)">驳回</button>
        </div>
        <p v-else-if="pendingPackage" class="perm-note">
          更新包 {{ pendingPackage.packageNo }} 正在审核中，需本区域档案审核员处理；审核期间不能再提交新的更新包。
        </p>
      </section>

      <section class="detail-block">
        <h4>附件（{{ detail.attachments.length }}）</h4>
        <table v-if="detail.attachments.length" class="data-table">
          <thead>
            <tr><th>附件名称</th><th>类别</th><th>上传人</th><th>上传时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="attachment in detail.attachments" :key="attachment.id">
              <td>{{ attachment.name }}</td>
              <td>{{ attachment.category }}</td>
              <td>{{ attachment.uploadedBy }}</td>
              <td>{{ attachment.uploadedAt }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">暂无附件</p>
        <form v-if="canAttach(detail.row)" class="inline-form" @submit.prevent="submitAttachment">
          <input v-model="attachmentForm.name" placeholder="附件名称，如 隐蔽工程验收影像.pdf" />
          <input v-model="attachmentForm.category" placeholder="附件类别，如 验收影像" />
          <button class="btn" type="submit">补充附件</button>
        </form>
        <p v-else class="perm-note">当前角色或区域无权补充附件（施工单位与档案管理员可补充本区域档案附件）。</p>
      </section>

      <section v-if="packageFormOpen" class="detail-block">
        <h4>提交更新包（基于当前版本 V{{ detail.currentVersion?.version ?? 0 }}）</h4>
        <p class="perm-note">更新包须包含设计图纸、竣工信息与承建企业变更三样材料；提交后进入审核，审核通过才替换当前版本，缺少材料不会改变当前归档状态。</p>
        <form class="package-form" @submit.prevent="submitPackage">
          <label>
            <span>设计图纸变更 *</span>
            <input v-model="packageForm.设计图纸" placeholder="新版设计图纸编号或说明" />
          </label>
          <label>
            <span>竣工信息 *</span>
            <input v-model="packageForm.竣工信息" placeholder="竣工日期 / 验收情况" />
          </label>
          <label>
            <span>承建企业变更 *</span>
            <input v-model="packageForm.承建企业" placeholder="变更后的承建企业" />
          </label>
          <label>
            <span>变更说明</span>
            <input v-model="packageForm.变更说明" placeholder="本次变更原因说明" />
          </label>
          <div class="form-actions">
            <button class="btn primary" type="submit">提交更新包</button>
            <button class="btn ghost" type="button" @click="packageFormOpen = false">取消</button>
          </div>
        </form>
      </section>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条设施档案记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  addAttachment,
  currentVersionMap,
  getArchiveDetail,
  reviewPackage,
  submitArchive,
  submitUpdatePackage,
  voidArchive,
} from '@/api/archive-service'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { ActionResult, ArchiveDetail, EntryRow, Operator } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('facility_archive')
const columns = ["档案编号", "设施名称", "设施类别", "所属区域", "竣工日期", "设计图纸", "承建企业", "档案状态"]
const statuses = ["待归档", "已归档", "待更新", "已作废"]

const store = useSessionStore()
const op = computed<Operator>(() => ({ name: store.operator, role: store.role, region: store.region }))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["档案编号", "设施名称", "所属区域"]
const versionMap = ref<Map<number, number>>(new Map())

const detail = ref<ArchiveDetail | null>(null)
const packageFormOpen = ref(false)
const packageForm = ref({ 设计图纸: '', 竣工信息: '', 承建企业: '', 变更说明: '' })
const attachmentForm = ref({ name: '', category: '' })
const reviewComment = ref('')

const stats = computed(() => [
  { label: '档案总数', value: rows.value.length },
  { label: '待归档档案', value: countStatus('待归档') },
  { label: '待更新档案', value: countStatus('待更新') },
  { label: '已作废档案', value: countStatus('已作废') },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countStatus(status) })),
)

const pendingPackage = computed(
  () => detail.value?.packages.find((pkg) => pkg.status === '审核中') ?? null,
)

const canReview = computed(
  () =>
    store.role === '档案审核员' &&
    detail.value?.row != null &&
    String(detail.value.row['所属区域']) === store.region,
)

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function sameRegion(row: EntryRow): boolean {
  return String(row['所属区域']) === store.region
}

function canSubmitArchive(row: EntryRow): boolean {
  return store.role === '档案管理员' && sameRegion(row) && row.status === '待归档'
}

function canSubmitPackage(row: EntryRow): boolean {
  return store.role === '档案管理员' && sameRegion(row) && row.status === '已归档'
}

function canVoid(row: EntryRow): boolean {
  return store.role === '档案管理员' && sameRegion(row) && row.status !== '已作废'
}

function canAttach(row: EntryRow): boolean {
  return (
    (store.role === '档案管理员' || store.role === '施工单位') &&
    sameRegion(row) &&
    row.status !== '已作废'
  )
}

function versionLabel(row: EntryRow): string {
  const version = versionMap.value.get(Number(row.id))
  return version ? `V${version}` : '—'
}

function applyResult(result: ActionResult) {
  if (result.ok) {
    reload()
    refreshDetail()
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
}

function openDetail(row: EntryRow) {
  detail.value = getArchiveDetail(Number(row.id))
  packageFormOpen.value = false
}

function closeDetail() {
  detail.value = null
  packageFormOpen.value = false
}

function refreshDetail() {
  if (detail.value?.row) {
    detail.value = getArchiveDetail(Number(detail.value.row.id))
  }
}

function runSubmitArchive(row: EntryRow) {
  applyResult(submitArchive(Number(row.id), op.value))
}

function openPackageForm(row: EntryRow) {
  openDetail(row)
  packageForm.value = { 设计图纸: '', 竣工信息: '', 承建企业: '', 变更说明: '' }
  packageFormOpen.value = true
}

function submitPackage() {
  if (!detail.value?.row) return
  applyResult(submitUpdatePackage(Number(detail.value.row.id), packageForm.value, op.value))
  if (!errorMessage.value) {
    packageFormOpen.value = false
  }
}

function runReview(approve: boolean) {
  if (!detail.value?.row || !pendingPackage.value) return
  applyResult(
    reviewPackage(
      Number(detail.value.row.id),
      pendingPackage.value.id,
      approve,
      reviewComment.value,
      op.value,
    ),
  )
  if (!errorMessage.value) {
    reviewComment.value = ''
  }
}

function submitAttachment() {
  if (!detail.value?.row) return
  applyResult(addAttachment(Number(detail.value.row.id), attachmentForm.value, op.value))
  if (!errorMessage.value) {
    attachmentForm.value = { name: '', category: '' }
  }
}

function runVoid(row: EntryRow) {
  applyResult(voidArchive(Number(row.id), op.value))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '设施档案登记入口尚未接入审批流'
  noticeMessage.value = ''
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    versionMap.value = currentVersionMap()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设施档案列表读取失败'
  }
}

onMounted(reload)
</script>
