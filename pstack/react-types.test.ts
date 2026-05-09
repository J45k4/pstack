import { useApi, useForm, type Endpoint } from "./react";

type ProjectId = string & { readonly __brand: "ProjectId" };

type Project = {
  id: ProjectId;
  name: string;
};

type CreateProjectInput = {
  name: string;
};

const ProjectId = {
  parse(value: string): ProjectId {
    return value as ProjectId;
  },
};

const getProject = null as unknown as Endpoint<
  "query",
  { id: ProjectId },
  Project
>;

const createProject = null as unknown as Endpoint<
  "mutation",
  CreateProjectInput,
  Project
>;

function TypeExamples({ params }: { params: { id: string } }) {
  const id = ProjectId.parse(params.id);
  const project = useApi(getProject, { id });

  project.data?.name;
  project.refetch();

  // @ts-expect-error string is not ProjectId
  useApi(getProject, { id: params.id });

  const mutation = useApi(createProject);

  mutation.mutate({ name: "PuppyStack" });

  // @ts-expect-error missing name
  mutation.mutate({});

  const form = useForm(createProject, {
    defaultValues: {
      name: "",
    },
  });

  form.submit(async input => {
    input.name;
    await mutation.mutate(input);
  });

  return project;
}

void TypeExamples;
