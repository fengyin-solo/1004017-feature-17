<template>
  <section class="page" data-module="facility_archive">
    <header class="page-head">
      <div>
        <h2>设施档案管理</h2>
        <p class="page-desc">
          版本包受控更新：归档后仅档案管理员可提交更新（含设计图纸、竣工信息、承建企业变更），审核通过才替换当前版本；
          施工单位只能查看与补充附件；跨区域不能改动其他区域档案；作废档案停止更新与引用，历史版本始终可追溯。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出设施档案清单</button>
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
      <span class="legend-item">当前身份：{{ session.role }} · {{ session.region }}（切换身份见页面右上角）</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>所属区域</span>
        <select v-model="regionFilter">
          <option value="">全部区域</option>
          <option v-for="region in regions" :key="region" :value="region">{{ region }}</option>
        </select>
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
        <tr v-for="row in filteredRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>
            <span>{{ row.status }}</span>
            <p v-if="reviewing(row)" class="cell-hint warn">更新包审核中，当前版本仍生效</p>
            <p v-else class="cell-hint">{{ currentVersionLabel(row) }}</p>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openHistory(row)">版本追溯</button>
            <button v-if="perm(row).canArchive" class="link" type="button" @click="doArchive(row)">提交归档</button>
            <button v-if="perm(row).canSubmitUpdate" class="link" type="button" @click="openUpdate(row)">提交更新包</button>
            <button v-if="perm(row).canReview" class="link" type="button" @click="openReview(row)">审核更新</button>
            <button v-if="perm(row).canSupplement" class="link" type="button" @click="openAttachment(row)">补充附件</button>
            <button v-if="perm(row).canVoid" class="link danger" type="button" @click="doVoid(row)">作废档案</button>
            <span v-if="!hasAnyAction(row)" class="cell-hint">仅可查看</span>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的设施档案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条设施档案记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 提交更新包 -->
    <div v-if="updateOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>提交受控更新包 · {{ updateTarget?.档案编号 }}</h3>
        <p class="modal-sub">
          当前版本 {{ currentVersionLabel(updateTarget) }}；更新包须包含设计图纸、竣工信息、承建企业变更三类材料，
          提交后进入审核，审核通过前不替换当前版本。
        </p>
        <label class="form-row">
          <span><em>*</em> 设计图纸（图册编号/版本）</span>
          <input v-model="updateForm.设计图纸" placeholder="如：滨江路干管-变更图册C版" />
        </label>
        <label class="form-row">
          <span><em>*</em> 竣工信息（竣工日期/规模变化）</span>
          <textarea v-model="updateForm.竣工信息" rows="2" placeholder="如：追加竣工日期 2026-10-02，新增接户管 120m" />
        </label>
        <label class="form-row">
          <span><em>*</em> 承建企业变更（无变更请填「无变更」）</span>
          <input v-model="updateForm.承建企业变更" placeholder="如：变更为某某建设有限公司；或填：无变更" />
        </label>
        <label class="form-row">
          <span>变更说明（选填）</span>
          <input v-model="updateForm.备注" placeholder="本次更新的事由" />
        </label>
        <p class="form-tip">
          提交人：{{ session.operator }}（{{ session.role }} · {{ session.region }}）。
          若已有更新包在审核，或材料缺失，提交会被拒绝且当前归档状态不变。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeAll">取消</button>
          <button class="btn primary" type="button" @click="submitUpdate">提交审核</button>
        </div>
      </div>
    </div>

    <!-- 审核更新包 -->
    <div v-if="reviewOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>审核更新包 · {{ reviewTarget?.档案编号 }}</h3>
        <div v-if="reviewPkg" class="pkg-detail">
          <p><b>提交人：</b>{{ reviewPkg.提交人 }}（{{ reviewPkg.提交人区域 }}） · {{ reviewPkg.提交时间 }}</p>
          <p><b>设计图纸：</b>{{ reviewPkg.设计图纸 }}</p>
          <p><b>竣工信息：</b>{{ reviewPkg.竣工信息 }}</p>
          <p><b>承建企业变更：</b>{{ reviewPkg.承建企业变更 }}</p>
          <p><b>备注：</b>{{ reviewPkg.备注 || '—' }}</p>
          <p class="form-tip">通过后将生成新版本并替换当前版本，旧版本保留可追溯；驳回须填写意见，当前版本继续生效。</p>
        </div>
        <label class="form-row">
          <span>审核意见<em>（驳回必填，需指出缺失材料）</em></span>
          <textarea v-model="reviewOpinion" rows="3" placeholder="如：缺少最新版竣工图，请补齐后重新提交" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeAll">取消</button>
          <button class="btn danger-btn" type="button" @click="doReview(false)">驳回（不换版）</button>
          <button class="btn primary" type="button" @click="doReview(true)">审核通过并换版</button>
        </div>
      </div>
    </div>

    <!-- 补充附件 -->
    <div v-if="attachmentOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>补充附件 · {{ attachmentTarget?.档案编号 }}</h3>
        <p class="modal-sub">施工单位仅可补充附件，不修改档案内容与版本；附件挂在 {{ currentVersionLabel(attachmentTarget) }} 下。</p>
        <label class="form-row">
          <span><em>*</em> 附件名称（演示环境填写文件名即可）</span>
          <input v-model="attachmentName" placeholder="如：现场复测照片-202610.zip" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeAll">取消</button>
          <button class="btn primary" type="button" @click="submitAttachment">补充附件</button>
        </div>
      </div>
    </div>

    <!-- 版本追溯 -->
    <div v-if="historyOpen" class="modal-mask wide" @click.self="closeAll">
      <div class="modal">
        <h3>版本追溯 · {{ historyTarget?.档案编号 }} {{ historyTarget?.设施名称 }}</h3>

        <h4>历史版本（共 {{ historyTarget?.versions.length ?? 0 }} 个，始终可追溯）</h4>
        <table class="data-table inner-table">
          <thead>
            <tr><th>版本</th><th>设计图纸</th><th>竣工信息</th><th>承建企业</th><th>提交/生效</th></tr>
          </thead>
          <tbody>
            <tr v-for="version in [...(historyTarget?.versions ?? [])].reverse()" :key="version.version">
              <td>
                {{ version.version }}
                <span v-if="version.version === currentVersionLabel(historyTarget)" class="tag">当前</span>
              </td>
              <td>{{ version.设计图纸 }}</td>
              <td>{{ version.竣工信息 }}</td>
              <td>{{ version.承建企业 }}</td>
              <td>{{ version.提交时间 }} → {{ version.生效时间 }}<br /><span class="cell-hint">{{ version.变更说明 }}</span></td>
            </tr>
            <tr v-if="!(historyTarget?.versions.length)"><td colspan="5" class="empty-state">尚无版本（待归档）</td></tr>
          </tbody>
        </table>

        <h4>更新包记录</h4>
        <table class="data-table inner-table">
          <thead>
            <tr><th>#</th><th>状态</th><th>材料</th><th>提交人</th><th>审核</th></tr>
          </thead>
          <tbody>
            <tr v-for="pkg in [...(historyTarget?.packages ?? [])].reverse()" :key="pkg.id">
              <td>{{ pkg.id }}</td>
              <td>{{ pkg.status }}</td>
              <td>
                图纸：{{ pkg.设计图纸 }}<br />
                竣工：{{ pkg.竣工信息 }}<br />
                企业变更：{{ pkg.承建企业变更 }}
              </td>
              <td>{{ pkg.提交人 }}（{{ pkg.提交人角色 }}）<br /><span class="cell-hint">{{ pkg.提交时间 }}</span></td>
              <td>
                <template v-if="pkg.status === '审核中'">待审核</template>
                <template v-else>{{ pkg.审核人 }} · {{ pkg.审核时间 }}<br /><span class="cell-hint">{{ pkg.审核意见 }}</span></template>
              </td>
            </tr>
            <tr v-if="!(historyTarget?.packages.length)"><td colspan="5" class="empty-state">暂无更新包</td></tr>
          </tbody>
        </table>

        <h4>补充附件</h4>
        <table class="data-table inner-table">
          <thead>
            <tr><th>附件名称</th><th>上传人</th><th>上传时间</th><th>所属版本</th></tr>
          </thead>
          <tbody>
            <tr v-for="file in historyTarget?.attachments ?? []" :key="file.name + file.上传时间">
              <td>{{ file.name }}</td>
              <td>{{ file.上传人 }}（{{ file.上传人角色 }}）</td>
              <td>{{ file.上传时间 }}</td>
              <td>{{ file.version }}</td>
            </tr>
            <tr v-if="!(historyTarget?.attachments.length)"><td colspan="4" class="empty-state">暂无补充附件</td></tr>
          </tbody>
        </table>

        <div class="modal-actions">
          <button class="btn primary" type="button" @click="closeAll">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  archivePermissions,
  currentVersion,
  downloadEntries,
  listArchiveRows,
  moduleMeta,
  reviewArchivePackage,
  submitArchive as submitArchiveApi,
  submitArchiveUpdate,
  supplementArchiveAttachment,
  voidFacilityArchive,
} from '@/api/local-service'
import type { ArchivePermissions as ArchivePerms } from '@/api/facility-archive'
import type {
  ArchivePackage,
  FacilityArchiveRow,
  UpdatePackageInput,
} from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('facility_archive')
const session = useSessionStore()
const columns = ['档案编号', '设施名称', '设施类别', '所属区域', '竣工日期', '设计图纸', '承建企业']
const filterFields = ['档案编号', '设施名称', '设施类别']
const regions = ['城东片区', '城西片区', '城南片区', '城北片区']

const allData = ref<FacilityArchiveRow[]>([])
const filters = ref<Record<string, string>>({})
const regionFilter = ref('')
const message = ref('')
const messageOk = ref(false)

// 更新包弹窗
const updateOpen = ref(false)
const updateTarget = ref<FacilityArchiveRow | null>(null)
const updateForm = reactive<UpdatePackageInput>({ 设计图纸: '', 竣工信息: '', 承建企业变更: '', 备注: '' })

// 审核弹窗
const reviewOpen = ref(false)
const reviewTarget = ref<FacilityArchiveRow | null>(null)
const reviewPkg = ref<ArchivePackage | null>(null)
const reviewOpinion = ref('')

// 补充附件弹窗
const attachmentOpen = ref(false)
const attachmentTarget = ref<FacilityArchiveRow | null>(null)
const attachmentName = ref('')

// 版本追溯弹窗
const historyOpen = ref(false)
const historyTarget = ref<FacilityArchiveRow | null>(null)

const stats = computed(() => [
  { label: '档案总数', value: allData.value.length },
  { label: '已归档档案', value: allData.value.filter((row) => row.status === '已归档').length },
  { label: '审核中更新包', value: allData.value.filter((row) => reviewing(row) !== null).length },
  { label: '已作废档案', value: allData.value.filter((row) => row.status === '已作废').length },
])

const statusSummary = computed(() =>
  ['待归档', '已归档', '已作废'].map((status) => ({
    status,
    count: allData.value.filter((row) => row.status === status).length,
  })),
)

const filteredRows = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  return allData.value.filter((row) => {
    const matchText = pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim()))
    const matchRegion = regionFilter.value === '' || String(row.所属区域 ?? '') === regionFilter.value
    return matchText && matchRegion
  })
})

function reviewing(row: FacilityArchiveRow | null): ArchivePackage | null {
  if (!row) return null
  return row.packages.find((item) => item.status === '审核中') ?? null
}

function currentVersionLabel(row: FacilityArchiveRow | null): string {
  if (!row) return '—'
  return currentVersion(row)?.version ?? '—'
}

function operatorContext() {
  return { role: session.role, region: session.region, operatorName: session.operator }
}

function perm(row: FacilityArchiveRow): ArchivePerms {
  return archivePermissions(row, { role: session.role, region: session.region })
}

function hasAnyAction(row: FacilityArchiveRow): boolean {
  const p = perm(row)
  return p.canArchive || p.canSubmitUpdate || p.canReview || p.canSupplement || p.canVoid
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function resetFilters() {
  filters.value = {}
  regionFilter.value = ''
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  allData.value = listArchiveRows()
}

function closeAll() {
  updateOpen.value = false
  reviewOpen.value = false
  attachmentOpen.value = false
  historyOpen.value = false
  updateTarget.value = null
  reviewTarget.value = null
  reviewPkg.value = null
  attachmentTarget.value = null
  historyTarget.value = null
  reviewOpinion.value = ''
  attachmentName.value = ''
  Object.assign(updateForm, { 设计图纸: '', 竣工信息: '', 承建企业变更: '', 备注: '' })
}

function doArchive(row: FacilityArchiveRow) {
  const result = submitArchiveApi(Number(row.id), operatorContext())
  notify(result.ok, result.message)
  if (result.ok) reload()
}

function openUpdate(row: FacilityArchiveRow) {
  updateTarget.value = row
  Object.assign(updateForm, { 设计图纸: '', 竣工信息: '', 承建企业变更: '无变更', 备注: '' })
  updateOpen.value = true
}

function submitUpdate() {
  if (!updateTarget.value) return
  const result = submitArchiveUpdate(Number(updateTarget.value.id), { ...updateForm }, operatorContext())
  notify(result.ok, result.message)
  if (result.ok) {
    closeAll()
    reload()
  }
}

function openReview(row: FacilityArchiveRow) {
  const pkg = reviewing(row)
  if (!pkg) {
    notify(false, '该档案没有审核中的更新包')
    return
  }
  reviewTarget.value = row
  reviewPkg.value = pkg
  reviewOpinion.value = ''
  reviewOpen.value = true
}

function doReview(approved: boolean) {
  if (!reviewTarget.value || !reviewPkg.value) return
  const result = reviewArchivePackage(
    Number(reviewTarget.value.id),
    Number(reviewPkg.value.id),
    approved,
    reviewOpinion.value,
    operatorContext(),
  )
  notify(result.ok, result.message)
  if (result.ok) {
    closeAll()
    reload()
  }
}

function openAttachment(row: FacilityArchiveRow) {
  attachmentTarget.value = row
  attachmentName.value = ''
  attachmentOpen.value = true
}

function submitAttachment() {
  if (!attachmentTarget.value) return
  const result = supplementArchiveAttachment(
    Number(attachmentTarget.value.id),
    attachmentName.value,
    operatorContext(),
  )
  notify(result.ok, result.message)
  if (result.ok) {
    closeAll()
    reload()
  }
}

function openHistory(row: FacilityArchiveRow) {
  historyTarget.value = row
  historyOpen.value = true
}

function doVoid(row: FacilityArchiveRow) {
  const confirmed = window.confirm(
    `确认作废档案 ${String(row.档案编号)}？作废后不能再更新或被缺陷记录引用，历史版本仍保留。`,
  )
  if (!confirmed) return
  const result = voidFacilityArchive(Number(row.id), { role: session.role, region: session.region })
  notify(result.ok, result.message)
  if (result.ok) reload()
}

onMounted(reload)
</script>
