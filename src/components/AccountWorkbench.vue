<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  accounts: {
    type: Array,
    default: () => []
  },
  selectedAccountId: {
    type: String,
    default: ''
  },
  layout: {
    type: String,
    default: 'auto'
  }
});

const emit = defineEmits(['select', 'refresh', 'create', 'delete', 'layout']);

const name = ref('');
const phone = ref('');
const password = ref('');
const browserSlots = ref(new Map());

function setSlotRef(accountId, element) {
  if (element) browserSlots.value.set(accountId, element);
  else browserSlots.value.delete(accountId);
}

function visibleAccounts() {
  if (props.layout === 'single') return props.accounts.filter((account) => account.id === props.selectedAccountId).slice(0, 1);
  const limit = props.layout === '2x2' ? 4 : props.layout === '3x3' ? 9 : 12;
  return props.accounts.slice(0, limit);
}

async function syncBrowserBounds() {
  await nextTick();
  const items = visibleAccounts()
    .map((account) => {
      const element = browserSlots.value.get(account.id);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        accountId: account.id,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        }
      };
    })
    .filter(Boolean);
  await window.fanqieApp?.setAccountBrowserBounds?.({
    visibleAccountIds: items.map((item) => item.accountId),
    items
  });
}

async function openVisibleBrowsers() {
  await nextTick();
  for (const item of visibleAccounts()) {
    const element = browserSlots.value.get(item.id);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    await window.fanqieApp?.openAccountBrowser?.({
      accountId: item.id,
      bounds: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
    });
  }
  await syncBrowserBounds();
}

function submitAccount() {
  emit('create', {
    name: name.value.trim() || phone.value.trim() || '新账号',
    phone: phone.value.trim(),
    password: password.value
  });
  name.value = '';
  phone.value = '';
  password.value = '';
}

function gridClass() {
  if (props.layout === 'single') return 'single';
  if (props.layout === '2x2') return 'two';
  if (props.layout === '3x3') return 'three';
  return 'auto';
}

let resizeObserver = null;

onMounted(() => {
  resizeObserver = new ResizeObserver(() => syncBrowserBounds());
  window.addEventListener('resize', syncBrowserBounds);
  openVisibleBrowsers();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect?.();
  window.removeEventListener('resize', syncBrowserBounds);
  window.fanqieApp?.setAccountBrowserBounds?.({ visibleAccountIds: [], items: [] });
});

watch(
  () => [props.accounts.map((account) => account.id).join(','), props.selectedAccountId, props.layout],
  () => openVisibleBrowsers()
);
</script>

<template>
  <section class="account-workbench">
    <aside class="account-sidebar">
      <div class="panel-heading">
        <h2>账号</h2>
        <button type="button" @click="emit('refresh')">刷新</button>
      </div>

      <form class="account-form" @submit.prevent="submitAccount">
        <input v-model="name" type="text" placeholder="账号备注" />
        <input v-model="phone" type="text" placeholder="手机号" />
        <input v-model="password" type="password" placeholder="密码，可留空" />
        <button class="primary-button" type="submit">添加账号</button>
      </form>

      <div class="account-list">
        <button
          v-for="account in props.accounts"
          :key="account.id"
          :class="['account-row', account.id === props.selectedAccountId ? 'selected' : '']"
          type="button"
          @click="emit('select', account.id)"
        >
          <strong>{{ account.name }}</strong>
          <span>{{ account.phone || '未填写手机号' }}</span>
          <small>{{ account.status }}</small>
        </button>
      </div>
    </aside>

    <section class="browser-workspace">
      <div class="browser-toolbar">
        <div class="layout-buttons">
          <button type="button" @click="emit('layout', 'single')">单窗</button>
          <button type="button" @click="emit('layout', '2x2')">2x2</button>
          <button type="button" @click="emit('layout', '3x3')">3x3</button>
          <button type="button" @click="emit('layout', 'auto')">自动</button>
        </div>
        <button type="button" :disabled="!props.selectedAccountId" @click="emit('delete', props.selectedAccountId)">删除选中账号</button>
      </div>

      <div :class="['browser-grid', gridClass()]">
        <article
          v-for="account in visibleAccounts()"
          :key="account.id"
          :class="['browser-tile', account.id === props.selectedAccountId ? 'selected' : '']"
          @click="emit('select', account.id)"
        >
          <header>
            <strong>{{ account.name }}</strong>
            <span>{{ account.status }}</span>
          </header>
          <div :ref="(el) => setSlotRef(account.id, el)" class="browser-slot"></div>
        </article>
        <p v-if="!props.accounts.length" class="empty-hint">先添加账号，再在这里登录番茄后台。</p>
      </div>
    </section>
  </section>
</template>
