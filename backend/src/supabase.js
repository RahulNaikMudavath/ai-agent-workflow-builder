const graphqlUrl = process.env.NHOST_GRAPHQL_URL;
const adminSecret = process.env.NHOST_ADMIN_SECRET;

async function graphqlRequest(query, variables = {}) {
  if (!graphqlUrl) {
    throw new Error("NHOST_GRAPHQL_URL is missing");
  }

  if (!adminSecret) {
    throw new Error("NHOST_ADMIN_SECRET is missing");
  }

  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": adminSecret,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result?.errors?.[0]?.message || "GraphQL request failed"
    );
  }

  if (result.errors) {
    throw new Error(result.errors[0].message);
  }

  return result.data;
}

module.exports = {
  graphqlRequest,
};