import { ProjectResource } from '@/core/types/models';
export interface ProjectJson {
    title: string;
    description?: string;
    parent?: string;
    enabled?: boolean;
    inheritable?: boolean;
}
export interface IgnitionProject {
    id: string;
    title: string;
    description?: string;
    parent?: string;
    enabled: boolean;
    inheritable: boolean;
    path: string;
    resources: Map<string, ProjectResource>;
    inheritanceChain: string[];
}
