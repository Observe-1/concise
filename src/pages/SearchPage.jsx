import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import SearchCard from '../components/cards/SearchCard';
import SearchTogglesCard from '../components/cards/SearchTogglesCard';


const useStyles = makeStyles({
    searchPage: {
        position: "relative",
        padding: "20px 16px",
        justifyContent: "center",
        alignItems: "center",
    },
});

export default function SearchPage(props) {
    const classes = useStyles();
    return (
        <div className={classes.searchPage}>
            <SearchCard />
            <SearchTogglesCard style={{ marginLeft: "5%", marginRight: "5%" }} />
        </div>
    );
}