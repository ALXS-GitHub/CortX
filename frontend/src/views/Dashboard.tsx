import { useState, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectListItem } from '@/components/projects/ProjectListItem';
import { ProjectCompactItem } from '@/components/projects/ProjectCompactItem';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Search, LayoutGrid, Star } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Project, CreateProjectInput, UpdateProjectInput } from '@/types';

type SortOption = 'recent' | 'name' | 'created' | 'status';

export function Dashboard() {
  const { projects, tagDefinitions, statusDefinitions, createProject, updateProject, deleteProject, isLoadingProjects, serviceRuntimes } = useAppStore();
  const { projectsViewMode, setProjectsViewMode } = useViewPrefsStore();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortOption>('recent');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  const sortedTagDefs = useMemo(
    () => [...tagDefinitions].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)),
    [tagDefinitions]
  );

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  };

  const allStatuses = useMemo(() => {
    const set = new Set([
      ...statusDefinitions.map((d) => d.name),
      ...projects.map((p) => p.status).filter(Boolean) as string[],
    ]);
    return Array.from(set);
  }, [projects, statusDefinitions]);

  const runningProjects = useMemo(
    () =>
      projects.filter((p) => p.services.some((s) => serviceRuntimes.get(s.id)?.status === 'running')).length,
    [projects, serviceRuntimes]
  );

  const filteredProjects = useMemo(() => {
    let result = projects;

    // Tag filter (OR semantics)
    if (selectedTags.size > 0) {
      result = result.filter((p) =>
        p.tags.some((t) => selectedTags.has(t.toLowerCase()))
      );
    }

    if (selectedStatus) {
      result = result.filter((p) => p.status === selectedStatus);
    }

    if (favoritesOnly) {
      result = result.filter((p) => p.favorite);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return result.slice().sort((a, b) => {
      // Favorites float to the top of whatever sort is active.
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'status': {
          const statusOrder = (s?: string) => {
            if (!s) return Infinity;
            const def = statusDefinitions.find((d) => d.name === s);
            return def?.order ?? Infinity;
          };
          const diff = statusOrder(a.status) - statusOrder(b.status);
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        }
        case 'recent':
        default: {
          const aDate = a.lastOpenedAt || a.createdAt;
          const bDate = b.lastOpenedAt || b.createdAt;
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        }
      }
    });
  }, [projects, selectedTags, selectedStatus, favoritesOnly, search, sort, statusDefinitions]);

  const handleToggleFavorite = async (project: Project) => {
    try {
      await updateProject(project.id, { favorite: !project.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const handleAddProject = async (data: CreateProjectInput | UpdateProjectInput) => {
    await createProject(data as CreateProjectInput);
  };

  const handleEditProject = async (data: CreateProjectInput | UpdateProjectInput) => {
    if (editingProject) {
      await updateProject(editingProject.id, data as UpdateProjectInput);
      setEditingProject(null);
    }
  };

  const handleDeleteProject = async () => {
    if (deletingProject) {
      await deleteProject(deletingProject.id);
      setDeletingProject(null);
    }
  };

  const subtitle = isLoadingProjects
    ? 'Loading…'
    : `${projects.length} project${projects.length !== 1 ? 's' : ''}${runningProjects > 0 ? ` · ${runningProjects} running` : ''}`;

  return (
    <Screen
      title="Projects"
      subtitle={subtitle}
      actions={
        <Button onClick={() => setShowAddForm(true)}>
          <Plus />
          Add project
        </Button>
      }
      toolbar={
        <>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {allStatuses.length > 0 && (
            <Select
              value={selectedStatus ?? '__all__'}
              onValueChange={(v) => setSelectedStatus(v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                {allStatuses.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently used</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="created">Date created</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            title="Show favorites only"
            className={cn(favoritesOnly && 'border-accent-border bg-accent')}
          >
            <Star className={favoritesOnly ? 'fill-warning text-warning' : ''} />
            Favorites
          </Button>
          <div className="ml-auto">
            <ViewModeToggle value={projectsViewMode} onChange={setProjectsViewMode} />
          </div>

          {sortedTagDefs.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-1.5">
              {sortedTagDefs.map((tag) => {
                const isActive = selectedTags.has(tag.name.toLowerCase());
                return (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => toggleTag(tag.name.toLowerCase())}
                    aria-pressed={isActive}
                    className={cn('rounded-full transition-opacity', isActive ? 'ring-2 ring-ring/50 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100')}
                  >
                    <Chip color={tag.color} neutral={!tag.color} dot={false}>
                      {tag.name}
                    </Chip>
                  </button>
                );
              })}
              {selectedTags.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTags(new Set())}
                  className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </>
      }
    >
      {isLoadingProjects ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">Loading projects…</div>
      ) : filteredProjects.length === 0 ? (
        projects.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title="No projects yet"
            description="Register a folder with its services, scripts and env files to launch it from one place."
            action={
              <Button onClick={() => setShowAddForm(true)}>
                <Plus />
                Add project
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Search} title="No matching projects" description="Try a different search or clear the filters." />
        )
      ) : projectsViewMode === 'card' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={() => setEditingProject(project)}
              onDelete={() => setDeletingProject(project)}
              onToggleFavorite={() => handleToggleFavorite(project)}
            />
          ))}
        </div>
      ) : projectsViewMode === 'list' ? (
        <div className="space-y-2">
          {filteredProjects.map((project) => (
            <ProjectListItem
              key={project.id}
              project={project}
              onEdit={() => setEditingProject(project)}
              onDelete={() => setDeletingProject(project)}
              onToggleFavorite={() => handleToggleFavorite(project)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {filteredProjects.map((project) => (
            <ProjectCompactItem
              key={project.id}
              project={project}
              onEdit={() => setEditingProject(project)}
              onDelete={() => setDeletingProject(project)}
              onToggleFavorite={() => handleToggleFavorite(project)}
            />
          ))}
        </div>
      )}

      {/* Add Project Dialog */}
      <ProjectForm
        open={showAddForm}
        onOpenChange={setShowAddForm}
        onSubmit={handleAddProject}
      />

      {/* Edit Project Dialog */}
      {editingProject && (
        <ProjectForm
          open={!!editingProject}
          onOpenChange={(open) => !open && setEditingProject(null)}
          project={editingProject}
          onSubmit={handleEditProject}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingProject} onOpenChange={(open) => !open && setDeletingProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deletingProject?.name}" from CortX? Your files on disk are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteProject}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
