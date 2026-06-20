/**
 * node-toolbar registry 通用性硬验收(L5-G5 / G5.9)
 *
 * 证明:容器零硬编码 section 清单 —— 任意节点类型注册任意 section 组合(数量无上限),
 * resolveSections 按声明顺序解析,容器据此渲染。这是设计灵魂(§4.2),也是 family-tree /
 * mock 节点接入的通用性保证:新增节点类型 / section 只注册不改容器。
 *
 * 用纯 registry(只 import type)在 node 环境直测,不拉 React/three。
 */
import { describe, it, expect } from 'vitest';
import {
  registerSection,
  registerNodeBinding,
  resolveSections,
  getSection,
} from '@capabilities/node-toolbar/registry';
import type { NodeSnapshot, SectionDef } from '@capabilities/node-toolbar/types';

/** 造一个最小 section（icon/Panel 用占位,resolve 只关心 id/顺序） */
function mockSection(id: string): SectionDef {
  return {
    id,
    title: id,
    icon: () => null,
    Panel: () => null,
  };
}

function snap(kind: string): NodeSnapshot {
  return { id: 'n1', kind, ref: 'mock.ref' };
}

describe('node-toolbar registry 通用性(G5.9)', () => {
  it('任意节点类型注册任意 section 组合 → resolveSections 按声明顺序返回', () => {
    // 模拟一个全新节点类型(如 family-tree person / knowledge node),注册 3 个自定义 section
    registerSection(mockSection('g59-info'));
    registerSection(mockSection('g59-link'));
    registerSection(mockSection('g59-icon'));
    registerNodeBinding({
      match: (node) => node.kind === 'g59-person',
      sections: ['g59-info', 'g59-link', 'g59-icon'],
    });

    const resolved = resolveSections(snap('g59-person'));
    expect(resolved.map((s) => s.id)).toEqual(['g59-info', 'g59-link', 'g59-icon']);
  });

  it('数量无上限:注册 5 个 section 的组合照样全解析', () => {
    const ids = ['g59-a', 'g59-b', 'g59-c', 'g59-d', 'g59-e'];
    ids.forEach((id) => registerSection(mockSection(id)));
    registerNodeBinding({ match: (n) => n.kind === 'g59-many', sections: ids });
    expect(resolveSections(snap('g59-many')).map((s) => s.id)).toEqual(ids);
  });

  it('0 section 节点(如只读 person):返回空 → 容器不出浮条', () => {
    registerNodeBinding({ match: (n) => n.kind === 'g59-readonly', sections: [] });
    expect(resolveSections(snap('g59-readonly'))).toEqual([]);
  });

  it('未注册的节点类型:无 binding 命中 → 空数组(不崩)', () => {
    expect(resolveSections(snap('g59-never-registered'))).toEqual([]);
  });

  it('binding 引用未注册 section:跳过该 id,其余正常(容错不崩)', () => {
    registerSection(mockSection('g59-real'));
    registerNodeBinding({
      match: (n) => n.kind === 'g59-partial',
      sections: ['g59-real', 'g59-ghost-不存在'],
    });
    expect(resolveSections(snap('g59-partial')).map((s) => s.id)).toEqual(['g59-real']);
  });

  it('getSection:注册后可取回', () => {
    registerSection(mockSection('g59-fetch'));
    expect(getSection('g59-fetch')?.id).toBe('g59-fetch');
    expect(getSection('g59-absent')).toBeUndefined();
  });
});
