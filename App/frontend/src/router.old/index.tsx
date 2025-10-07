import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import Home from '../pages/Home';
import ProjectMenu from '../pages/ProjectMenu';
// import Chat from '../pages/Chat';
// import StoryObjectsEditor from '../pages/StoryObjectsEditor';
import Workspace from '../pages/Workspace';
import NovelEditor from '../pages/NovelEditor';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: '/project/:projectId',
        element: <ProjectMenu />,
      },
      {
        path: '/project/:projectId/workspace',
        element: <Workspace />,
      },
      {
        path: '/project/:projectId/novel-editor',
        element: <NovelEditor />,
      }
    ],
  },
]);