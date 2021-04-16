import React from 'react';
import Switch from '@material-ui/core/Switch';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import CardActions from '@material-ui/core/CardActions';
import Typography from "@material-ui/core/Typography";
import { fade, makeStyles } from "@material-ui/core/styles";


const useStyles = makeStyles({
  root: {
    minWidth: 275,
    boxShadow: "0 4px 8px 0 rgba(0,0,0,0.2)",
    transition: "0.3s",
    width: "50%",
    marginTop: "20px",
    marginLeft: "25%",
    marginRight: "25%",
  },
});

export default function SearchTogglesCard() {

  const [state, setState] = React.useState({
    checkedA: true,
    checkedB: true,
  });

  const handleChange = (event) => {
    setState({ ...state, [event.target.name]: event.target.checked });
  };
  const classes = useStyles();
  return (
    <Card className={classes.root} >
      <CardContent>
        <Typography variant="h4" component="h2">
          Enrichment Options
        </Typography>
      </CardContent>
      <CardActions>
        <Typography component="h2">
          Location
        </Typography>
        <Switch
          checked={state.checkedA}
          onChange={handleChange}
          color="primary"
          name="checkedA"
          inputProps={{ 'aria-label': 'secondary checkbox' }}
        />
        <Typography component="h2">
          Transport
        </Typography>
        <Switch
          checked={state.checkedB}
          onChange={handleChange}
          color="primary"
          name="checkedB"
          inputProps={{ 'aria-label': 'primary checkbox' }}
        />
      </CardActions>
    </Card >
  );
}